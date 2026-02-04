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

// Scale factor for recording (to reduce data transfer overhead)
// IPC throughput testing shows 1/2 scale causes 80% frame drops
// Using 1/4 scale as compromise between quality and performance
// 1/4 = 480x270 for 1080p output (~518KB per frame)
const RECORDING_SCALE = 1 / 4;

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
  const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const isSendingRef = useRef<boolean>(false);
  const droppedFramesRef = useRef<number>(0);
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
    captureFrame: () => captureAndSendFrame(),
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
   * Capture frame and send to Tauri
   */
  const captureAndSendFrame = useCallback(() => {
    // Skip if previous frame is still being sent (backpressure)
    if (isSendingRef.current) {
      droppedFramesRef.current++;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    // First composite the frame on the display canvas
    compositeFrame();

    // Get current dimensions from refs
    const width = recordingWidthRef.current;
    const height = recordingHeightRef.current;

    // Create or get the recording canvas (scaled down for performance)
    if (!recordingCanvasRef.current) {
      recordingCanvasRef.current = document.createElement("canvas");
      recordingCanvasRef.current.width = width;
      recordingCanvasRef.current.height = height;
    }

    const recordingCanvas = recordingCanvasRef.current;
    const recordingCtx = recordingCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!recordingCtx) return;

    // Draw scaled version to recording canvas
    recordingCtx.drawImage(canvas, 0, 0, width, height);

    // Get pixel data (RGBA) as Uint8Array for efficient binary transfer
    const imageData = recordingCtx.getImageData(0, 0, width, height);

    // Calculate timestamp
    const timestampMs = performance.now() - recordingStartTimeRef.current;

    // Mark as sending
    isSendingRef.current = true;

    // Send frame asynchronously - use Promise.resolve to defer to next tick
    Promise.resolve().then(async () => {
      const startTime = performance.now();
      try {
        // Use base64 encoding - faster than JSON array for large binary data
        // Base64 is ~33% larger but encoding is much faster than array iteration
        const uint8Array = new Uint8Array(imageData.data.buffer);
        
        // Convert to base64 using btoa with chunked processing for large arrays
        let binaryStr = "";
        const chunkSize = 32768; // Process in 32KB chunks to avoid call stack issues
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
          binaryStr += String.fromCharCode.apply(null, chunk as unknown as number[]);
        }
        const base64Data = btoa(binaryStr);

        if (frameCountRef.current === 0) {
          const encodeTime = performance.now() - startTime;
          console.log(
            `[RecordingCanvas] Sending first frame: ${uint8Array.length} bytes -> ${base64Data.length} base64 chars (encode: ${encodeTime.toFixed(1)}ms)`,
          );
        }

        await invoke("receive_video_frame_base64", {
          dataBase64: base64Data,
          width: width,
          height: height,
          timestampMs: Math.round(timestampMs),
        });

        frameCountRef.current++;
        lastFrameTimeRef.current = performance.now();

        // Log progress every 30 frames
        if (frameCountRef.current % 30 === 0) {
          const totalTime = performance.now() - startTime;
          console.log(
            `[RecordingCanvas] Progress: ${frameCountRef.current} frames sent, ${droppedFramesRef.current} dropped (last frame: ${totalTime.toFixed(1)}ms)`,
          );
        }
      } catch (error) {
        console.error(
          `[RecordingCanvas] Failed to send frame ${frameCountRef.current}:`,
          error,
        );

        // Check if this is a "Not recording" error (happens on stop, expected)
        if (!String(error).includes("Not recording")) {
          onFrameErrorRef.current?.(String(error));
        }
      } finally {
        isSendingRef.current = false;
      }
    });
  }, [compositeFrame]);

  // Start/stop frame capture based on recording state
  useEffect(() => {
    if (!isRecording) {
      return;
    }

    // Start recording
    console.log(`[RecordingCanvas] Starting recording session`);
    recordingStartTimeRef.current = performance.now();
    frameCountRef.current = 0;
    droppedFramesRef.current = 0;
    lastFrameTimeRef.current = performance.now();

    const intervalMs = 1000 / frameRateRef.current;
    console.log(
      `[RecordingCanvas] Starting capture: ${recordingWidthRef.current}x${recordingHeightRef.current} @ ${frameRateRef.current}fps (${intervalMs}ms interval)`,
    );
    console.log(
      `[RecordingCanvas] Frame data size: ${recordingWidthRef.current * recordingHeightRef.current * 4} bytes per frame`,
    );

    // Frame capture interval
    frameIntervalRef.current = window.setInterval(() => {
      const elapsed =
        (performance.now() - recordingStartTimeRef.current) / 1000;
      if (frameCountRef.current % 50 === 0) {
        console.log(
          `[RecordingCanvas] Interval still running: ${frameCountRef.current} frames, ${elapsed.toFixed(1)}s elapsed, interval ID: ${frameIntervalRef.current}`,
        );
      }

      try {
        captureAndSendFrame();
      } catch (error) {
        console.error(
          `[RecordingCanvas] Error in capture loop at frame ${frameCountRef.current}:`,
          error,
        );
      }
    }, intervalMs);

    console.log(
      `[RecordingCanvas] Interval started with ID: ${frameIntervalRef.current}`,
    );

    // Watchdog to detect stalls
    watchdogIntervalRef.current = window.setInterval(() => {
      const timeSinceLastFrame = performance.now() - lastFrameTimeRef.current;
      const expectedInterval = 1000 / frameRateRef.current;

      if (timeSinceLastFrame > expectedInterval * 3) {
        console.error(
          `[RecordingCanvas] WATCHDOG: No frame sent in ${(timeSinceLastFrame / 1000).toFixed(1)}s! Last frame: ${frameCountRef.current}, isSending: ${isSendingRef.current}, interval ID: ${frameIntervalRef.current}`,
        );
      }
    }, 1000);

    // Cleanup
    return () => {
      console.log(`[RecordingCanvas] Cleanup - stopping intervals`);
      if (frameIntervalRef.current !== null) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
      if (watchdogIntervalRef.current !== null) {
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
      }

      const elapsed =
        (performance.now() - recordingStartTimeRef.current) / 1000;
      console.log(
        `[RecordingCanvas] Session ended: ${frameCountRef.current} frames captured, ${droppedFramesRef.current} dropped, ${elapsed.toFixed(1)}s elapsed`,
      );

      const expectedFrames = Math.floor(elapsed * frameRateRef.current);
      if (frameCountRef.current < expectedFrames * 0.7) {
        console.error(
          `[RecordingCanvas] WARNING: Only captured ${frameCountRef.current} frames in ${elapsed.toFixed(1)}s, expected ~${expectedFrames} frames`,
        );
      }
    };
  }, [isRecording]); // Only depend on isRecording to prevent restarts

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
