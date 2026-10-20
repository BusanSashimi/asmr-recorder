import { Channel, invoke } from "@tauri-apps/api/core";
import { parseFrameHeader } from "./screen-wire";
export type { FrameHeader } from "./screen-wire";
export { parseFrameHeader } from "./screen-wire";

import { captureProfileKey, nativeCaptureTarget, type CaptureProfile, type CaptureTarget } from "./native-capture-target";

type FrameCallback = (bitmap: ImageBitmap, frame: ScreenStreamFrame) => void;
interface Source { onFrame: FrameCallback; opts: NativeScreenOptions }
interface Active { channel: Channel<ArrayBuffer>; streamId: string; key: string; ready: boolean; timestamp: number }
const channels = new Map<number, Active>();
const configurations = new Map<number, Source>();
const starting = new Map<number, symbol>();
let suspended = false;
let lifecycle = 0;
let version = 0;
let profile: CaptureProfile | undefined;
let tail: Promise<unknown> = Promise.resolve();
let reconciliation: Promise<void> | undefined;
const cancelled = () => ({ kind: "cancelled", message: "Screen capture preparation was cancelled." });
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = tail.then(task);
  tail = result.catch(() => {});
  return result;
}

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
  /** Backing pixels per logical point; width/height are points on macOS. */
  pointPixelScale: number;
}

export type DisplayGeometry = Pick<DisplayInfo, "width" | "height" | "pointPixelScale">;

export interface NativeScreenOptions {
  /** Display index to capture (0 = primary). */
  displayIndex?: number;
  displayId?: number;
  expectedGeometry?: DisplayGeometry;
  /** Target capture frame rate. */
  fps?: number;
  /** Longest output dimension in px (frames are downscaled to fit). */
  maxDimension?: number;
  targetSize?: CaptureTarget;
  /** Display-local crop: logical points on macOS, pixels elsewhere. */
  region?: { x: number; y: number; width: number; height: number };
}

function targetFor(index: number, opts: NativeScreenOptions) {
  if (!profile || !opts.expectedGeometry) {
    return { targetSize: opts.targetSize, maxDimension: opts.maxDimension ?? 1280, fps: opts.fps ?? 30 };
  }
  const targetSize = nativeCaptureTarget(index, opts.expectedGeometry, opts.region, profile);
  return targetSize ? { targetSize, maxDimension: Math.max(targetSize.width, targetSize.height), fps: profile.frameRate ?? 30 } : null;
}

async function pauseSection(sectionIndex: number) {
  const active = channels.get(sectionIndex);
  if (!active) return;
  active.ready = false;
  channels.delete(sectionIndex);
  active.channel.onmessage = () => {};
  await invoke("stop_screen_stream", { sectionIndex, streamId: active.streamId });
}

async function launch(sectionIndex: number, source: Source, target: NonNullable<ReturnType<typeof targetFor>>,
  current: () => boolean): Promise<Channel<ArrayBuffer>> {
  const channel = new Channel<ArrayBuffer>();
  const streamId = crypto.randomUUID();
  const active: Active = { channel, streamId, key: JSON.stringify(target), ready: false, timestamp: -1 };
  let pending: ArrayBuffer | undefined;
  const isCurrent = () => !suspended && active.ready && channels.get(sectionIndex) === active;
  const ack = () => { void invoke("ack_screen_frame", { sectionIndex, streamId }).catch(() => {}); };
  channel.onmessage = (buf: ArrayBuffer) => {
    if (!active.ready && current() && !suspended) {
      if (pending) ack();
      pending = buf;
      return;
    }
    if (!isCurrent()) { ack(); return; }
    const header = parseFrameHeader(buf);
    if (!header) { ack(); return; }
    const jpeg = new Blob([buf.slice(header.jpegOffset)], { type: "image/jpeg" });
    void createImageBitmap(jpeg).then(bitmap => {
      if (!isCurrent() || header.timestampMs <= active.timestamp) { bitmap.close(); return; }
      active.timestamp = header.timestampMs;
      try { source.onFrame(bitmap, header); } catch (error) { bitmap.close(); throw error; }
    }).catch(error => console.warn("[native-screen] frame decode failed:", error)).finally(ack);
  };
  try {
    await invoke("start_screen_stream", {
      sectionIndex, streamId,
      displayIndex: source.opts.displayIndex ?? 0,
      displayId: source.opts.displayId ?? null,
      expectedGeometry: source.opts.expectedGeometry ?? null,
      region: source.opts.region ?? null,
      targetSize: target.targetSize ?? null,
      maxDimension: target.maxDimension, fps: target.fps, onFrame: channel,
    });
    if (!current() || suspended) {
      await invoke("stop_screen_stream", { sectionIndex, streamId });
      throw cancelled();
    }
    const previous = channels.get(sectionIndex);
    if (previous) { previous.ready = false; previous.channel.onmessage = () => {}; }
    channels.set(sectionIndex, active);
    active.ready = true;
    if (pending) { const frame = pending; pending = undefined; channel.onmessage(frame); }
    return channel;
  } catch (error) {
    pending = undefined;
    channel.onmessage = () => {};
    throw error;
  }
}

/** Retain the old selection until the new native capture has started successfully. */
export function startNativeScreenStream(sectionIndex: number, onFrame: FrameCallback,
  opts: NativeScreenOptions = {}): Promise<Channel<ArrayBuffer>> {
  const operation = Symbol();
  const epoch = lifecycle;
  starting.set(sectionIndex, operation);
  const current = () => epoch === lifecycle && starting.get(sectionIndex) === operation;
  return enqueue(async () => {
    if (!current() || suspended) throw cancelled();
    const source = { onFrame, opts };
    const target = targetFor(sectionIndex, opts);
    // Initial source selection must be capturable in the current layout.
    if (!target) throw cancelled();
    const channel = await launch(sectionIndex, source, target, current);
    configurations.set(sectionIndex, source);
    version++;
    return channel;
  }).finally(() => { if (starting.get(sectionIndex) === operation) starting.delete(sectionIndex); });
}

export async function listDisplays(): Promise<DisplayInfo[]> {
  return invoke<DisplayInfo[]>("list_displays");
}

/** Forget a selection immediately; serialize backend stop with any pending startup. */
export function stopNativeScreenStream(sectionIndex: number): Promise<void> {
  configurations.delete(sectionIndex);
  starting.delete(sectionIndex);
  version++;
  const active = channels.get(sectionIndex);
  if (active) active.ready = false;
  return enqueue(() => pauseSection(sectionIndex)).catch(error => {
    console.warn("[native-screen] stop failed:", error);
  });
}

/** Coalesce profile changes; only the latest layout/resolution/fps is applied. */
export function reconcileNativeScreens(next?: CaptureProfile): Promise<void> {
  if (next && (!profile || captureProfileKey(next) !== captureProfileKey(profile))) {
    profile = { ...next };
    version++;
  }
  if (reconciliation) return reconciliation;
  const result = enqueue(async () => {
    for (;;) {
      const revision = version;
      if (suspended) return;
      for (const [index, source] of configurations) {
        if (suspended) throw cancelled();
        const target = targetFor(index, source.opts);
        if (!target) { await pauseSection(index); continue; }
        if (channels.get(index)?.key === JSON.stringify(target) && channels.get(index)?.ready) continue;
        const epoch = lifecycle;
        await launch(index, source, target, () => configurations.get(index) === source && epoch === lifecycle);
        if (revision !== version) break;
      }
      if (revision === version) return;
    }
  });
  reconciliation = result;
  const clear = () => { if (reconciliation === result) reconciliation = undefined; };
  void result.then(clear, clear);
  return result;
}

/** A recording starts only after all selected, visible native sources are current. */
export async function prepareNativeScreens(next: CaptureProfile): Promise<void> {
  const epoch = lifecycle;
  await reconcileNativeScreens(next);
  // A selection can have been queued behind an earlier reconciliation.
  await tail;
  await reconcileNativeScreens();
  if (suspended || epoch !== lifecycle) throw cancelled();
}

/** Retain source choices and latest profile while releasing native capture. */
export async function suspendNativeScreens(value: boolean): Promise<void> {
  if (value === suspended) return;
  suspended = value;
  lifecycle++;
  version++;
  if (value) {
    starting.clear();
    channels.forEach(active => { active.ready = false; });
    await enqueue(async () => {
      for (const index of [...channels.keys()]) await pauseSection(index);
    });
  } else {
    await reconcileNativeScreens();
  }
}
