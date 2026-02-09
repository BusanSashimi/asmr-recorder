import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ScreenRegion } from "@/types/recording";

interface SectionSource {
  type: "video" | "canvas" | null;
  element: HTMLVideoElement | HTMLCanvasElement | null;
  region?: ScreenRegion | null;
}

interface RecordingCanvasProps {
  /** Output width in pixels */
  outputWidth: number;
  /** Output height in pixels */
  outputHeight: number;
  /** Target frame rate */
  frameRate: number;
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Callback when a frame fails to send */
  onFrameError?: (error: string) => void;
  /** Section sources (video or canvas elements for each section) */
  sectionSources: [SectionSource, SectionSource, SectionSource, SectionSource];
  /** Optional getter function to get fresh sources on each frame (preferred) */
  getSectionSources?: () => [SectionSource, SectionSource, SectionSource, SectionSource];
}

export interface RecordingCanvasRef {
  /** Get the composite canvas element */
  getCanvas: () => HTMLCanvasElement | null;
  /** Force a frame capture (for debugging) */
  captureFrame: () => void;
}

// Scale factor for recording
// NOW USING MediaRecorder API: Browser-native canvas recording!
// Automatic encoding and muxing, full 1920x1080 @ 60fps capable
const RECORDING_SCALE = 1 / 1;

/**
 * RecordingCanvas - Composites 4 section sources into a 2x2 grid and sends frames to Tauri
 *
 * This component renders a hidden canvas that composites all video/canvas sources
 * from the preview sections. When recording is active, it captures frames at the
 * target frame rate and sends them to the Tauri backend for encoding.
 */
export const RecordingCanvas = forwardRef<
  RecordingCanvasRef,
  RecordingCanvasProps
>(function RecordingCanvas(
  {
    outputWidth,
    outputHeight,
    frameRate,
    isRecording,
    onFrameError,
    sectionSources,
    getSectionSources,
  },
  ref,
) {
  // Calculate dimensions first (before refs that depend on them)
  const sectionWidth = outputWidth / 2;
  const sectionHeight = outputHeight / 2;
  const recordingWidth = Math.floor(outputWidth * RECORDING_SCALE);
  const recordingHeight = Math.floor(outputHeight * RECORDING_SCALE);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const watchdogIntervalRef = useRef<number | null>(null);
  const sectionSourcesRef =
    useRef<[SectionSource, SectionSource, SectionSource, SectionSource]>(
      sectionSources,
    );
  const getSectionSourcesRef = useRef(getSectionSources);
  const recordingWidthRef = useRef(recordingWidth);
  const recordingHeightRef = useRef(recordingHeight);
  const frameRateRef = useRef(frameRate);
  const onFrameErrorRef = useRef(onFrameError);

  // MediaRecorder for recording canvas stream
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Update refs when props change
  useEffect(() => {
    sectionSourcesRef.current = sectionSources;
    getSectionSourcesRef.current = getSectionSources;
    recordingWidthRef.current = recordingWidth;
    recordingHeightRef.current = recordingHeight;
    frameRateRef.current = frameRate;
    onFrameErrorRef.current = onFrameError;
  }, [sectionSources, getSectionSources, recordingWidth, recordingHeight, frameRate, onFrameError]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    captureFrame: () => updateFrame(),
  }));

  /**
   * Draw a single section onto the composite canvas
   */
  const drawSection = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      source: SectionSource,
      destX: number,
      destY: number,
      destWidth: number,
      destHeight: number,
    ) => {
      if (!source.element || source.type === null) {
        // Draw placeholder for empty section
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(destX, destY, destWidth, destHeight);
        return;
      }

      try {
        if (source.type === "video") {
          const video = source.element as HTMLVideoElement;
          if (video.readyState >= video.HAVE_CURRENT_DATA) {
            // Draw video, scaling to fit section
            ctx.drawImage(video, destX, destY, destWidth, destHeight);
          } else {
            // Video not ready, draw placeholder
            if (frameCountRef.current < 5 || frameCountRef.current % 50 === 0) {
              console.warn(
                `[RecordingCanvas] Video not ready at frame ${frameCountRef.current}: readyState=${video.readyState}, paused=${video.paused}, ended=${video.ended}, srcObject=${!!video.srcObject}`,
              );
            }
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(destX, destY, destWidth, destHeight);
          }
        } else if (source.type === "canvas") {
          const canvas = source.element as HTMLCanvasElement;
          if (canvas.width > 0 && canvas.height > 0) {
            // Draw canvas content, scaling to fit section
            ctx.drawImage(canvas, destX, destY, destWidth, destHeight);
          } else {
            if (frameCountRef.current < 5) {
              console.warn(
                `[RecordingCanvas] Canvas invalid: ${canvas.width}x${canvas.height}`,
              );
            }
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(destX, destY, destWidth, destHeight);
          }
        }
      } catch (error) {
        // Drawing failed, draw placeholder
        if (frameCountRef.current < 5 || frameCountRef.current % 50 === 0) {
          console.error(
            `[RecordingCanvas] Error drawing section at frame ${frameCountRef.current}:`,
            error,
          );
        }
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(destX, destY, destWidth, destHeight);
      }
    },
    [],
  );

  /**
   * Composite all sections onto the canvas
   */
  const compositeFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      if (frameCountRef.current < 3)
        console.warn("[RecordingCanvas] Canvas ref not available");
      return;
    }

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      if (frameCountRef.current < 3)
        console.warn("[RecordingCanvas] Canvas context not available");
      return;
    }

    // Get current section sources - prefer getter function for fresh refs
    const currentSources = getSectionSourcesRef.current
      ? getSectionSourcesRef.current()
      : sectionSourcesRef.current;

    // Log section sources on first frame only
    if (frameCountRef.current === 0) {
      const sourcesInfo = currentSources
        .map((s, i) => {
          if (s.type === "video" && s.element) {
            const video = s.element as HTMLVideoElement;
            return `[${i}] VIDEO: ready=${video.readyState}, paused=${video.paused}, hasStream=${!!video.srcObject}`;
          } else if (s.type === "canvas" && s.element) {
            const canvas = s.element as HTMLCanvasElement;
            return `[${i}] CANVAS: ${canvas.width}x${canvas.height}`;
          } else {
            return `[${i}] EMPTY`;
          }
        })
        .join(", ");
      console.log(`[RecordingCanvas] Section sources: ${sourcesInfo}`);
    }

    // Clear canvas
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, outputWidth, outputHeight);

    // Draw each section in a 2x2 grid
    // Section 0: Top-left
    drawSection(ctx, currentSources[0], 0, 0, sectionWidth, sectionHeight);
    // Section 1: Top-right
    drawSection(
      ctx,
      currentSources[1],
      sectionWidth,
      0,
      sectionWidth,
      sectionHeight,
    );
    // Section 2: Bottom-left
    drawSection(
      ctx,
      currentSources[2],
      0,
      sectionHeight,
      sectionWidth,
      sectionHeight,
    );
    // Section 3: Bottom-right
    drawSection(
      ctx,
      currentSources[3],
      sectionWidth,
      sectionHeight,
      sectionWidth,
      sectionHeight,
    );

    // Draw grid lines (subtle separator between sections)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 2;
    // Vertical line
    ctx.beginPath();
    ctx.moveTo(sectionWidth, 0);
    ctx.lineTo(sectionWidth, outputHeight);
    ctx.stroke();
    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, sectionHeight);
    ctx.lineTo(outputWidth, sectionHeight);
    ctx.stroke();
  }, [outputWidth, outputHeight, sectionWidth, sectionHeight, drawSection]);

  /**
   * Initialize MediaRecorder to capture canvas stream
   */
  const initializeRecorder = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error('Canvas not available');
    }

    const width = recordingWidthRef.current;
    const height = recordingHeightRef.current;
    const fps = frameRateRef.current;

    try {
      // Create a stream from the canvas
      const stream = canvas.captureStream(fps);

      // Clear previous chunks
      recordedChunksRef.current = [];

      // Determine best codec - prefer VP9 > H264 > VP8
      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=h264';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm;codecs=vp8';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm'; // Fallback to default
          }
        }
      }

      console.log(`[MediaRecorder] Using codec: ${mimeType}`);

      // Create MediaRecorder
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5_000_000, // 5 Mbps - high quality
      });

      // Collect data chunks
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      // Handle stop event
      recorder.onstop = async () => {
        console.log(`[MediaRecorder] Recording stopped, ${recordedChunksRef.current.length} chunks collected`);

        // Create final blob
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        console.log(`[MediaRecorder] Final video size: ${blob.size} bytes`);

        try {
          // Convert blob to base64
          const arrayBuffer = await blob.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          let binaryStr = "";
          const chunkSize = 32768;
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
            binaryStr += String.fromCharCode.apply(null, chunk as unknown as number[]);
          }
          const base64Data = btoa(binaryStr);

          // Send to backend (we'll use a new command that accepts WebM)
          await invoke('save_media_recording', {
            videoData: base64Data,
            width,
            height,
            mimeType,
          });

          console.log(`[MediaRecorder] Video saved successfully`);
        } catch (error) {
          console.error('[MediaRecorder] Error saving video:', error);
          onFrameErrorRef.current?.(String(error));
        }
      };

      recorder.onerror = (event) => {
        console.error('[MediaRecorder] Recording error:', event);
        onFrameErrorRef.current?.('MediaRecorder error');
      };

      mediaRecorderRef.current = recorder;
      console.log(`[MediaRecorder] Initialized: ${width}x${height} @ ${fps}fps`);
    } catch (error) {
      console.error('[MediaRecorder] Failed to initialize:', error);
      throw error;
    }
  }, []);

  /**
   * Composite a frame on the canvas (MediaRecorder will capture automatically)
   */
  const updateFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const perfStart = performance.now();

    try {
      // Composite the frame on the canvas
      compositeFrame();
      const compositeTime = performance.now() - perfStart;

      frameCountRef.current++;
      lastFrameTimeRef.current = performance.now();

      // Log progress every 30 frames
      if (frameCountRef.current % 30 === 0) {
        const elapsed = (performance.now() - recordingStartTimeRef.current) / 1000;
        const fps = frameCountRef.current / elapsed;
        console.log(
          `[RecordingCanvas-MediaRecorder] Frame ${frameCountRef.current}: ` +
          `composite=${compositeTime.toFixed(1)}ms, ` +
          `fps=${fps.toFixed(1)}, ` +
          `elapsed=${elapsed.toFixed(1)}s`
        );
      }
    } catch (error) {
      console.error(
        `[RecordingCanvas] Failed to composite frame ${frameCountRef.current}:`,
        error,
      );
      onFrameErrorRef.current?.(String(error));
    }
  }, [compositeFrame]);

  // Start/stop recording based on recording state
  useEffect(() => {
    if (!isRecording) {
      return;
    }

    // Initialize and start recording
    try {
      console.log(`[RecordingCanvas] Starting recording session`);
      recordingStartTimeRef.current = performance.now();
      frameCountRef.current = 0;
      lastFrameTimeRef.current = performance.now();

      // Initialize MediaRecorder
      initializeRecorder();

      // Start MediaRecorder
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        throw new Error('MediaRecorder not initialized');
      }

      // Start recording with 1 second chunks
      recorder.start(1000);
      console.log(
        `[RecordingCanvas] Recording started: ${recordingWidthRef.current}x${recordingHeightRef.current} @ ${frameRateRef.current}fps`,
      );

      // Composite frame interval to keep canvas updated
      const intervalMs = 1000 / frameRateRef.current;
      frameIntervalRef.current = window.setInterval(() => {
        try {
          updateFrame();
        } catch (error) {
          console.error(
            `[RecordingCanvas] Error in composite loop at frame ${frameCountRef.current}:`,
            error,
          );
        }
      }, intervalMs);

      console.log(
        `[RecordingCanvas] Composite interval started at ${intervalMs}ms (${frameRateRef.current}fps)`,
      );

      // Watchdog to detect stalls
      watchdogIntervalRef.current = window.setInterval(() => {
        const timeSinceLastFrame = performance.now() - lastFrameTimeRef.current;
        const expectedInterval = 1000 / frameRateRef.current;

        if (timeSinceLastFrame > expectedInterval * 3) {
          console.warn(
            `[RecordingCanvas] WATCHDOG: No frame composited in ${(timeSinceLastFrame / 1000).toFixed(1)}s! ` +
            `Last frame: ${frameCountRef.current}`,
          );
        }
      }, 1000);
    } catch (error) {
      console.error('[RecordingCanvas] Failed to start recording:', error);
      onFrameErrorRef.current?.(String(error));
    }

    // Cleanup
    return () => {
      console.log(`[RecordingCanvas] Cleanup - stopping recording`);

      // Stop intervals
      if (frameIntervalRef.current !== null) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
      if (watchdogIntervalRef.current !== null) {
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
      }

      // Stop MediaRecorder (will trigger onstop handler)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
          console.log('[RecordingCanvas] MediaRecorder stopped');
        } catch (error) {
          console.error('[RecordingCanvas] Error stopping MediaRecorder:', error);
        }
      }

      const elapsed =
        (performance.now() - recordingStartTimeRef.current) / 1000;
      console.log(
        `[RecordingCanvas] Session ended: ${frameCountRef.current} frames composited, ${elapsed.toFixed(1)}s elapsed`,
      );
    };
  }, [isRecording, initializeRecorder, updateFrame]);

  // Set canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = outputWidth;
      canvas.height = outputHeight;
    }
  }, [outputWidth, outputHeight]);

  // No preview rendering needed - canvas is hidden and only used during recording

  return (
    <canvas
      ref={canvasRef}
      width={outputWidth}
      height={outputHeight}
      className="hidden"
      aria-hidden="true"
    />
  );
});
