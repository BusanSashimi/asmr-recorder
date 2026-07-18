import { describe, expect, it } from "vitest";
import { BuildSoundSelector, scheduleSoundbite } from "./build-sound-selection";

describe("BuildSoundSelector", () => {
  it("wraps sequentially and resets for a new recording", () => {
    const selector = new BuildSoundSelector("sequential");
    expect([selector.select(["a", "b"]), selector.select(["a", "b"]), selector.select(["a", "b"])]).toEqual(["a", "b", "a"]);
    selector.reset();
    expect(selector.select(["a", "b"])).toBe("a");
  });

  it("uses every shuffle item once and avoids a cross-cycle repeat", () => {
    const randomValues = [0, 0, 0.99, 0.99];
    const selector = new BuildSoundSelector("shuffle", () => randomValues.shift() ?? 0.99);
    const firstCycle = [selector.select(["a", "b", "c"]), selector.select(["a", "b", "c"]), selector.select(["a", "b", "c"])];
    const next = selector.select(["a", "b", "c"]);
    expect(new Set(firstCycle)).toEqual(new Set(["a", "b", "c"]));
    expect(next).not.toBe(firstCycle[2]);
  });

  it("filters unavailable IDs supplied by the caller", () => {
    const selector = new BuildSoundSelector("sequential");
    expect(selector.select(["available"])).toBe("available");
    expect(selector.select([])).toBeNull();
  });
});

it("schedules overlapping sources without stopping the previous source", () => {
  const starts: number[] = [];
  const makeSource = () => ({
    buffer: null,
    onended: null as (() => void) | null,
    connect: () => undefined,
    disconnect: () => undefined,
    start: () => starts.push(1),
  });
  const context = { createBufferSource: makeSource };
  const active = new Set<ReturnType<typeof makeSource>>();
  const buffer = {} as AudioBuffer;
  const gain = {} as AudioNode;
  scheduleSoundbite(context, gain, buffer, active);
  scheduleSoundbite(context, gain, buffer, active);
  expect(starts).toHaveLength(2);
  expect(active.size).toBe(2);
});
