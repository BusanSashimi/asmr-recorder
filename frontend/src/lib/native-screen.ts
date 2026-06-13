import { Channel, invoke } from "@tauri-apps/api/core";

/**
 * Native screen capture streamed from the Rust backend.
 *
 * WKWebView has no navigator.mediaDevices.getDisplayMedia, so the desktop app
 * captures the screen with ScreenCaptureKit and streams downscaled JPEG frames
 * over a Tauri Channel. The frontend decodes each frame to an ImageBitmap and
 * draws it into the section's canvas, which feeds the normal 2x2 composite.
 */

/** Metadata parsed from a raw native screen frame (16-byte LE header + JPEG). */
export interface ScreenStreamFrame {
  width: number;
  height: number;
  timestampMs: number;
}

/** Display information as returned by list_displays. */
export interface DisplayInfo {
  index: number;
  displayId: number;
  width: number;
  height: number;
  isPrimary: boolean;
}

export interface NativeScreenOptions {
  /** Display index to capture (0 = primary). */
  displayIndex?: number;
  /** Target capture frame rate. */
  fps?: number;
  /** Longest output dimension in px (frames are downscaled to fit). */
  maxDimension?: number;
  /** Optional crop region in display pixels. Omit for full display. */
  region?: { x: number; y: number; width: number; height: number };
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
): Promise<Channel<ArrayBuffer>> {
  const channel = new Channel<ArrayBuffer>();

  // Send one ack per decoded frame to restore backpressure credit in the worker.
  // Always ack (even on failure) so a single bad frame can't starve the stream.
  const ack = () => {
    invoke("ack_screen_frame", { sectionIndex }).catch(() => {});
  };

  channel.onmessage = (buf: ArrayBuffer) => {
    // Wire format: 16-byte LE header (u32 width, u32 height, u64 timestamp_ms)
    // followed by JPEG payload.
    const dv = new DataView(buf);
    const width = dv.getUint32(0, true);
    const height = dv.getUint32(4, true);
    const timestampMs = Number(dv.getBigUint64(8, true));
    const jpeg = new Blob([buf.slice(16)], { type: "image/jpeg" });
    createImageBitmap(jpeg)
      .then((bitmap) => { onFrame(bitmap, { width, height, timestampMs }); ack(); })
      .catch((e) => { console.warn("[native-screen] frame decode failed:", e); ack(); });
  };

  await invoke("start_screen_stream", {
    sectionIndex,
    displayIndex: opts.displayIndex ?? 0,
    fps: opts.fps ?? 30,
    maxDimension: opts.maxDimension ?? 1280,
    region: opts.region ?? null,
    onFrame: channel,
  });

  return channel;
}

/** Enumerate available displays. Returns ≥1 entry; primary is first on macOS. */
export async function listDisplays(): Promise<DisplayInfo[]> {
  return invoke<DisplayInfo[]>("list_displays");
}

/** Stop the native screen stream for a section (no-op if none is running). */
export async function stopNativeScreenStream(sectionIndex: number): Promise<void> {
  try {
    await invoke("stop_screen_stream", { sectionIndex });
  } catch (e) {
    console.warn("[native-screen] stop failed:", e);
  }
}
