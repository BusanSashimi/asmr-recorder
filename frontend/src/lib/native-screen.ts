import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * Native screen capture streamed from the Rust backend.
 *
 * WKWebView has no navigator.mediaDevices.getDisplayMedia, so the desktop app
 * captures the screen with ScreenCaptureKit and streams downscaled JPEG frames
 * over a Tauri Channel. The frontend decodes each frame to an ImageBitmap and
 * draws it into the section's canvas, which feeds the normal 2x2 composite.
 */

/** One streamed frame as delivered by the backend (camelCase to match serde). */
export interface ScreenStreamFrame {
  /** Base64-encoded JPEG image data. */
  data: string;
  width: number;
  height: number;
  timestampMs: number;
}

export interface NativeScreenOptions {
  /** Display index to capture (0 = primary). */
  displayIndex?: number;
  /** Target capture frame rate. */
  fps?: number;
  /** Longest output dimension in px (frames are downscaled to fit). */
  maxDimension?: number;
}

/**
 * Start a native screen stream for a section. Decoded frames are delivered to
 * `onFrame` as ImageBitmaps — the caller MUST close each bitmap after drawing.
 *
 * Returns the Channel so the caller can retain it for the stream's lifetime and
 * stop it with `stopNativeScreenStream(sectionIndex)`. (Tauri keeps the onmessage
 * callback alive in an internal registry, so delivery does not depend on the
 * reference being held; the backend stops only when stop_screen_stream is called.)
 */
export async function startNativeScreenStream(
  sectionIndex: number,
  onFrame: (bitmap: ImageBitmap, frame: ScreenStreamFrame) => void,
  opts: NativeScreenOptions = {},
): Promise<Channel<ScreenStreamFrame>> {
  const channel = new Channel<ScreenStreamFrame>();

  // The worker->JS hop has no backpressure (Channel.send is fire-and-forget), so
  // bound decoding to a single in-flight frame and keep only the latest while
  // busy. This prevents unbounded pile-up and out-of-order draws under load.
  let decoding = false;
  let pending: ScreenStreamFrame | null = null;

  const decode = (frame: ScreenStreamFrame) => {
    decoding = true;
    fetch(`data:image/jpeg;base64,${frame.data}`)
      .then((r) => r.blob())
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => onFrame(bitmap, frame))
      .catch((e) => console.warn("[native-screen] frame decode failed:", e))
      .finally(() => {
        decoding = false;
        if (pending) {
          const next = pending;
          pending = null;
          decode(next);
        }
      });
  };

  channel.onmessage = (frame) => {
    if (decoding) {
      pending = frame; // drop the previous pending frame; keep only the latest
      return;
    }
    decode(frame);
  };

  await invoke("start_screen_stream", {
    sectionIndex,
    displayIndex: opts.displayIndex ?? 0,
    fps: opts.fps ?? 30,
    maxDimension: opts.maxDimension ?? 1280,
    onFrame: channel,
  });

  return channel;
}

/** Stop the native screen stream for a section (no-op if none is running). */
export async function stopNativeScreenStream(sectionIndex: number): Promise<void> {
  try {
    await invoke("stop_screen_stream", { sectionIndex });
  } catch (e) {
    console.warn("[native-screen] stop failed:", e);
  }
}
