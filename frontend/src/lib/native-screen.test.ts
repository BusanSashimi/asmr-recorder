import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultExternalRecordingConfig } from "@/types/recording";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class { onmessage: (buffer: ArrayBuffer) => void = () => {}; },
}));
type Bridge = typeof import("./native-screen");
let bridge: Bridge;
const profile = { ...defaultExternalRecordingConfig, outputWidth: 2560, outputHeight: 1440 };
const opts = { displayId: 42, expectedGeometry: { width: 2560, height: 1440, pointPixelScale: 1 } };
const starts = () => invoke.mock.calls.filter(([command]) => command === "start_screen_stream").map(([, args]) => args);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function frame(timestamp: number) {
  const bytes = new ArrayBuffer(17);
  const view = new DataView(bytes);
  view.setUint32(0, 1280, true); view.setUint32(4, 720, true); view.setBigUint64(8, BigInt(timestamp), true);
  return bytes;
}
beforeEach(async () => {
  vi.resetModules(); invoke.mockReset(); invoke.mockResolvedValue(undefined);
  bridge = await import("./native-screen");
  await bridge.reconcileNativeScreens(profile);
});

describe("native screen reconciliation and delivery", () => {
  it("retains a static screen's first frame when it arrives before startup resolves", async () => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    try {
      invoke.mockImplementation(async (command, args) => {
        if (command === "start_screen_stream") args.onFrame.onmessage(frame(1));
      });
      const callback = vi.fn((image: ImageBitmap) => image.close());
      await bridge.startNativeScreenStream(0, callback, opts);
      await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === "ack_screen_frame")).toHaveLength(1));
    } finally { vi.unstubAllGlobals(); }
  });
  it("passes native output size and reconfigures only when sampling requirements change", async () => {
    await bridge.startNativeScreenStream(0, () => {}, opts);
    expect(starts()[0].targetSize).toEqual({ width: 1280, height: 720 });
    await bridge.reconcileNativeScreens({ ...profile, layout: "solo" });
    expect(starts()[1].targetSize).toEqual({ width: 2560, height: 1440 });
    await bridge.prepareNativeScreens({ ...profile, layout: "solo" });
    expect(starts()).toHaveLength(2);
  });
  it("suspends sections absent from layout and restores their selection and callback", async () => {
    const callback = vi.fn();
    await bridge.startNativeScreenStream(1, callback, opts);
    await bridge.reconcileNativeScreens({ ...profile, layout: "solo" });
    expect(invoke).toHaveBeenCalledWith("stop_screen_stream", expect.objectContaining({ sectionIndex: 1, streamId: starts()[0].streamId }));
    await bridge.reconcileNativeScreens(profile);
    expect(starts()).toHaveLength(2);
    expect(starts()[1].displayId).toBe(42);
  });
  it("coalesces rapid settings changes while startup is pending and preparation waits", async () => {
    await bridge.startNativeScreenStream(0, () => {}, opts);
    const pending = deferred();
    invoke.mockImplementation(command => command === "start_screen_stream" ? pending.promise : Promise.resolve());
    const change = bridge.reconcileNativeScreens({ ...profile, layout: "solo" });
    await vi.waitFor(() => expect(starts()).toHaveLength(2));
    const prepare = bridge.prepareNativeScreens({ ...profile, outputWidth: 3840, outputHeight: 2160 });
    let prepared = false; void prepare.then(() => { prepared = true; });
    await Promise.resolve(); expect(prepared).toBe(false);
    pending.resolve(); await change; await prepare;
    expect(starts()).toHaveLength(3);
    expect(starts()[2].targetSize).toEqual({ width: 1920, height: 1080 });
  });
  it("failed preparation keeps the selected source and is retried before recording", async () => {
    await bridge.startNativeScreenStream(0, () => {}, opts);
    invoke.mockRejectedValueOnce(new Error("capture failed"));
    await expect(bridge.reconcileNativeScreens({ ...profile, layout: "solo" })).rejects.toThrow("capture failed");
    await bridge.prepareNativeScreens({ ...profile, layout: "solo" });
    expect(starts()).toHaveLength(3);
    expect(starts()[2].displayId).toBe(42);
  });
  it("mode exit cancels pending preparation and late startup stops only its own stream", async () => {
    await bridge.startNativeScreenStream(0, () => {}, opts);
    const pending = deferred();
    invoke.mockImplementation(command => command === "start_screen_stream" ? pending.promise : Promise.resolve());
    const prepare = bridge.prepareNativeScreens({ ...profile, layout: "solo" });
    const rejected = expect(prepare).rejects.toMatchObject({ kind: "cancelled" });
    await vi.waitFor(() => expect(starts()).toHaveLength(2));
    const suspend = bridge.suspendNativeScreens(true);
    pending.resolve(); await rejected; await suspend;
    expect(invoke).toHaveBeenCalledWith("stop_screen_stream", { sectionIndex: 0, streamId: starts()[1].streamId });
    await bridge.suspendNativeScreens(false);
    expect(starts()).toHaveLength(3);
  });
  it("clearing during startup cannot resurrect the removed selection", async () => {
    const pending = deferred();
    invoke.mockImplementation(command => command === "start_screen_stream" ? pending.promise : Promise.resolve());
    const start = bridge.startNativeScreenStream(0, () => {}, opts);
    const rejected = expect(start).rejects.toMatchObject({ kind: "cancelled" });
    await vi.waitFor(() => expect(starts()).toHaveLength(1));
    const stop = bridge.stopNativeScreenStream(0);
    pending.resolve(); await rejected; await stop;
    await bridge.prepareNativeScreens(profile);
    expect(starts()).toHaveLength(1);
  });
  it("acknowledges retired decodes with their own ID and discards out-of-order bitmaps", async () => {
    const decoded: Array<(bitmap: ImageBitmap) => void> = [];
    vi.stubGlobal("createImageBitmap", vi.fn(() => new Promise<ImageBitmap>(resolve => decoded.push(resolve))));
    try {
      const callback = vi.fn();
      await bridge.startNativeScreenStream(0, callback, opts);
      const first = starts()[0]; first.onFrame.onmessage(frame(1));
      await bridge.reconcileNativeScreens({ ...profile, layout: "solo" });
      const old = { close: vi.fn() } as unknown as ImageBitmap;
      decoded[0](old);
      await vi.waitFor(() => expect(old.close).toHaveBeenCalled());
      expect(callback).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("ack_screen_frame", { sectionIndex: 0, streamId: first.streamId });
      const active = starts()[1];
      active.onFrame.onmessage(frame(2)); active.onFrame.onmessage(frame(3));
      decoded[2]({ close: vi.fn() } as unknown as ImageBitmap);
      await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
      const late = { close: vi.fn() } as unknown as ImageBitmap;
      decoded[1](late);
      await vi.waitFor(() => expect(late.close).toHaveBeenCalled());
      expect(callback).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
