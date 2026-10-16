/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { ENCODE_WORKLET_CODE } from "./encode-worklet";

function processor() {
  const packets: { channels: Float32Array[]; time: number }[] = [];
  let instance: {
    process: (input: Float32Array[][], output: Float32Array[][]) => boolean;
  };
  const scope = {
    AudioWorkletProcessor: class {
      port = {
        postMessage: (data: (typeof packets)[number]) => packets.push(data),
      };
    },
    registerProcessor: (
      _name: string,
      Constructor: new () => typeof instance,
    ) => {
      instance = new Constructor();
    },
    currentTime: 12,
    Float32Array,
  };
  runInNewContext(ENCODE_WORKLET_CODE, scope);
  return { instance: instance!, scope, packets };
}

describe("recording audio worklet", () => {
  it("keeps silent input quanta and their clock positions", () => {
    const { instance, scope, packets } = processor();
    const out = [new Float32Array(128), new Float32Array(128)];
    instance.process([], [out]);
    scope.currentTime = 12.5;
    instance.process([[new Float32Array(128).fill(0.25)]], [out]);
    expect(packets).toHaveLength(2);
    expect(packets[0].time).toBe(12);
    expect(packets[0].channels).toHaveLength(2);
    expect(packets[0].channels[0].every((x) => x === 0)).toBe(true);
    expect(packets[1].time).toBe(12.5);
    expect(packets[1].channels[1][0]).toBe(0.25);
  });
  it("copies separate channels without aliasing the render buffers", () => {
    const { instance, packets } = processor();
    const left = new Float32Array(256).fill(0.25),
      right = new Float32Array(256).fill(-0.5);
    instance.process(
      [[left, right]],
      [[new Float32Array(256), new Float32Array(256)]],
    );
    left.fill(0);
    right.fill(0);
    expect(packets[0].channels[0]).toHaveLength(256);
    expect(packets[0].channels[0][0]).toBe(0.25);
    expect(packets[0].channels[1][0]).toBe(-0.5);
  });
});
