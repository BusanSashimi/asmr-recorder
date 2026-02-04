import { useEffect, useRef, useCallback } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { ScreenRegion } from "@/types/recording";

interface SectionSource {
  type: "video" | "canvas" | null;
  element: HTMLVideoElement | HTMLCanvasElement | null;
  region?: ScreenRegion | null;
}

interface BrowserRecorderProps {
  /** Output width in pixels */
  outputWidth: number;
  /** Output height in pixels */
  outputHeight: number;
  /** Target frame rate */
  frameRate: number;
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Callback when recording starts */
  onRecordingStart?: () => void;
  /** Callback when recording stops with file path */
  onRecordingStop?: (filePath: string) => void;
  /** Callback when an error occurs */
  onError?: (error: string) => void;
  /** Section sources (video or canvas elements for each section) */
  sectionSources: [SectionSource, SectionSource, SectionSource, SectionSource];
}

/**
 * BrowserRecorder - Records the composite canvas using browser's MediaRecorder API
 * 
 * This uses the native browser recording capabilities instead of sending frames
 * through Tauri IPC, which is much more efficient.
 */
export function BrowserRecorder({
  outputWidth,
  outputHeight,
  frameRate,
  isRecording,
  onRecordingStart,
  onRecordingStop,
  onError,
  sectionSources,
}: BrowserRecorderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  const sectionWidth = outputWidth / 2;
  const sectionHeight = outputHeight / 2;

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
      destHeight: number
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
            ctx.drawImage(video, destX, destY, destWidth, destHeight);
          } else {
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(destX, destY, destWidth, destHeight);
          }
        } else if (source.type === "canvas") {
          const canvas = source.element as HTMLCanvasElement;
          ctx.drawImage(canvas, destX, destY, destWidth, destHeight);
        }
      } catch (error) {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(destX, destY, destWidth, destHeight);
        console.error("Error drawing section:", error);
      }
    },
    []
  );

  /**
   * Composite all sections onto the canvas
   */
  const compositeFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, outputWidth, outputHeight);

    // Draw each section in a 2x2 grid
    drawSection(ctx, sectionSources[0], 0, 0, sectionWidth, sectionHeight);
    drawSection(ctx, sectionSources[1], sectionWidth, 0, sectionWidth, sectionHeight);
    drawSection(ctx, sectionSources[2], 0, sectionHeight, sectionWidth, sectionHeight);
    drawSection(ctx, sectionSources[3], sectionWidth, sectionHeight, sectionWidth, sectionHeight);

    // Draw grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sectionWidth, 0);
    ctx.lineTo(sectionWidth, outputHeight);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, sectionHeight);
    ctx.lineTo(outputWidth, sectionHeight);
    ctx.stroke();
  }, [outputWidth, outputHeight, sectionWidth, sectionHeight, sectionSources, drawSection]);

  /**
   * Continuous rendering loop
   */
  const renderLoop = useCallback(() => {
    compositeFrame();
    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, [compositeFrame]);

  /**
   * Start recording using MediaRecorder
   */
  const startRecording = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      onError?.("Canvas not initialized");
      return;
    }

    try {
      // Get stream from canvas
      const stream = canvas.captureStream(frameRate);

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 5000000, // 5 Mbps
      });

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
        
        try {
          // Save file using Tauri dialog
          const filePath = await save({
            defaultPath: `recording_${timestamp}.webm`,
            filters: [{ name: "Video", extensions: ["webm"] }],
          });

          if (filePath) {
            // Convert blob to array buffer
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // Write file
            await writeFile(filePath, uint8Array);
            onRecordingStop?.(filePath);
          }
        } catch (error) {
          onError?.(String(error));
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
      mediaRecorderRef.current = mediaRecorder;
      onRecordingStart?.();

      console.log(`Browser recording started: ${outputWidth}x${outputHeight} @ ${frameRate}fps`);
    } catch (error) {
      console.error("Failed to start recording:", error);
      onError?.(String(error));
    }
  }, [frameRate, outputWidth, outputHeight, onRecordingStart, onRecordingStop, onError]);

  /**
   * Stop recording
   */
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      console.log("Browser recording stopped");
    }
  }, []);

  // Start/stop recording based on prop
  useEffect(() => {
    if (isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Set up canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = outputWidth;
      canvas.height = outputHeight;
    }
  }, [outputWidth, outputHeight]);

  // Start rendering loop
  useEffect(() => {
    animationFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderLoop]);

  return (
    <canvas
      ref={canvasRef}
      width={outputWidth}
      height={outputHeight}
      className="hidden"
      aria-hidden="true"
    />
  );
}
