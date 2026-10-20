import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramTransport, type Transport } from "./editor-transport";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function status(time: string, playing = false): Transport {
  return { time, playing, speed: 1, looping: false, sourceTime: "0", target: "program" };
}
const microtasks = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let frames: Map<number, FrameRequestCallback>;
function nextFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(0));
}

beforeEach(() => {
  frames = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => vi.unstubAllGlobals());

describe("program transport", () => {
  it("updates optimistically and sends only the latest position per animation frame", async () => {
    const send = vi.fn(async (_action: string, time?: string) => status(time!));
    const transport = new ProgramTransport(send);
    transport.seek("1");
    transport.seek("2");
    transport.seek("3");
    expect(transport.getSnapshot().time).toBe("3");
    expect(send).not.toHaveBeenCalled();
    nextFrame();
    await microtasks();
    expect(send.mock.calls).toEqual([["seek", "3"]]);
    expect(transport.getSnapshot().seeking).toBe(false);
  });

  it("keeps one seek in flight and never publishes an obsolete response", async () => {
    const first = deferred<Transport>();
    const final = deferred<Transport>();
    const send = vi.fn<(action: string, time?: string) => Promise<Transport>>()
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(final.promise);
    const transport = new ProgramTransport(send);
    transport.seek("1");
    nextFrame();
    transport.seek("2");
    transport.seek("3", { flush: true });
    nextFrame();
    expect(send).toHaveBeenCalledTimes(1);
    first.resolve(status("1"));
    await microtasks();
    expect(transport.getSnapshot().time).toBe("3");
    nextFrame();
    expect(send.mock.calls).toEqual([["seek", "1"], ["seek", "3"]]);
    final.resolve(status("3"));
    await microtasks();
    expect(transport.getSnapshot()).toMatchObject({ time: "3", seeking: false });
  });

  it("flushes release and deduplicates an already requested final position", async () => {
    const send = vi.fn(async (_action: string, time?: string) => status(time!));
    const transport = new ProgramTransport(send);
    transport.seek("8");
    transport.seek("8", { flush: true });
    expect(send).toHaveBeenCalledWith("seek", "8");
    await microtasks();
    transport.seek("8", { flush: true });
    nextFrame();
    expect(send).toHaveBeenCalledTimes(1);
    // The same location must still pause playback if it has since resumed.
    transport.observe(status("8", true), transport.version, false);
    transport.seek("8", { flush: true });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("ignores stale status polling and does not overwrite an optimistic seek", async () => {
    const send = vi.fn(async () => status("5"));
    const transport = new ProgramTransport(send);
    const old = transport.version;
    transport.seek("5");
    expect(transport.observe(status("2", true), old, true)).toBe(false);
    expect(transport.observe(status("2", true), transport.version, true)).toBe(false);
    nextFrame();
    await microtasks();
    expect(transport.observe(status("2", true), old, true)).toBe(false);
    expect(transport.getSnapshot().time).toBe("5");
  });

  it("does not rerender the workspace for unchanged paused status polls", () => {
    const transport = new ProgramTransport(vi.fn());
    transport.observe(status("5"), transport.version, true);
    const listener = vi.fn();
    const unsubscribe = transport.subscribe(listener);
    transport.observe(status("5"), transport.version, false);
    transport.observe(status("5"), transport.version, true);
    expect(listener).not.toHaveBeenCalled();
    transport.observe({ ...status("5"), note: "Playback warning" }, transport.version, false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("ignores a playback response launched before a new seek", async () => {
    const play = deferred<Transport>();
    const send = vi.fn<(action: string, time?: string) => Promise<Transport>>()
      .mockReturnValueOnce(play.promise).mockResolvedValueOnce(status("8"));
    const transport = new ProgramTransport(send);
    const command = transport.run("play");
    await microtasks();
    transport.seek("8");
    play.resolve(status("1", true));
    await command;
    expect(transport.getSnapshot().time).toBe("8");
    nextFrame();
    await microtasks();
    expect(transport.getSnapshot().status?.playing).toBe(false);
  });

  it.each(["play", "forward", "reverse", "toggle"])(
    "delivers the final seek before a subsequent %s command", async (action) => {
      const first = deferred<Transport>();
      const send = vi.fn<(action: string, time?: string) => Promise<Transport>>()
        .mockReturnValueOnce(first.promise)
        .mockImplementation(async (action, time) => status(time ?? "3", action !== "status"));
      const transport = new ProgramTransport(send);
      transport.seek("1");
      nextFrame();
      transport.seek("3");
      const play = transport.run(action);
      await microtasks();
      expect(send).toHaveBeenCalledTimes(1);
      first.resolve(status("1"));
      await microtasks();
      nextFrame();
      await play;
      expect(send.mock.calls.map(([action]) => action)).toEqual(
        action === "toggle" ? ["seek", "seek", "status", "play"] : ["seek", "seek", action],
      );
      expect(transport.getSnapshot().time).toBe("3");
      expect(transport.getSnapshot().status?.playing).toBe(true);
    },
  );

  it("reconciles rejected seeks without sending pause and allows retry", async () => {
    const send = vi.fn<(action: string, time?: string) => Promise<Transport>>()
      .mockRejectedValueOnce("Stop and save the voice-over take before seeking.")
      .mockResolvedValueOnce(status("2", true))
      .mockResolvedValueOnce(status("8"));
    const transport = new ProgramTransport(send);
    await transport.run("seek", "8");
    expect(send.mock.calls.map(([action]) => action)).toEqual(["seek", "status"]);
    expect(transport.getSnapshot()).toMatchObject({
      time: "2", seeking: false, error: "Stop and save the voice-over take before seeking.",
    });
    await transport.run("seek", "8");
    expect(transport.getSnapshot()).toMatchObject({ time: "8", error: null });
  });

  it("ignores an obsolete seek failure and continues to the latest target", async () => {
    const first = deferred<Transport>();
    const send = vi.fn<(action: string, time?: string) => Promise<Transport>>()
      .mockReturnValueOnce(first.promise).mockResolvedValueOnce(status("8"));
    const transport = new ProgramTransport(send);
    transport.seek("1", { flush: true });
    transport.seek("8");
    first.reject("Old failure");
    await microtasks();
    nextFrame();
    await microtasks();
    expect(send.mock.calls).toEqual([["seek", "1"], ["seek", "8"]]);
    expect(transport.getSnapshot()).toMatchObject({ time: "8", error: null, seeking: false });
  });

  it("discards scheduled work, stale results and queued playback on session change", async () => {
    const first = deferred<Transport>();
    const send = vi.fn(() => first.promise);
    const transport = new ProgramTransport(send);
    transport.seek("1", { flush: true });
    transport.seek("8");
    const play = transport.run("play");
    await microtasks();
    const old = transport.version;
    transport.cancel();
    first.resolve(status("1"));
    await play;
    await microtasks();
    nextFrame();
    expect(transport.isCurrent(old)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(transport.getSnapshot().time).toBe(null);
    transport.seek("9");
    transport.cancel();
    nextFrame();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
