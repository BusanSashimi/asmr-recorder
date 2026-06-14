import { describe, it, expect } from "vitest";
import { splitSegment, keptDuration, formatTime, MIN_SEG } from "./trim-segments";

describe("splitSegment", () => {
  const seg = { in: 0, out: 10 };

  it("mid-cut produces two segments", () => {
    const result = splitSegment(seg, 3, 7);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ in: 0, out: 3 });
    expect(result[1]).toEqual({ in: 7, out: 10 });
  });

  it("cut at head leaves only the tail segment", () => {
    const result = splitSegment(seg, 0, 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ in: 5, out: 10 });
  });

  it("cut at tail leaves only the head segment", () => {
    const result = splitSegment(seg, 5, 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ in: 0, out: 5 });
  });

  it("cut spanning whole segment returns empty array", () => {
    expect(splitSegment(seg, 0, 10)).toHaveLength(0);
  });

  it("drops head sliver smaller than MIN_SEG", () => {
    // head would be 0.05s — below default MIN_SEG of 0.1
    const result = splitSegment(seg, 0.05, 5);
    expect(result).toHaveLength(1);
    expect(result[0].in).toBe(5);
  });

  it("drops tail sliver smaller than MIN_SEG", () => {
    const result = splitSegment(seg, 5, 9.95);
    expect(result).toHaveLength(1);
    expect(result[0].out).toBe(5);
  });

  it("respects a custom minSeg argument", () => {
    // with minSeg=0, even tiny slivers survive
    const result = splitSegment(seg, 0.01, 9.99, 0);
    expect(result).toHaveLength(2);
  });
});

describe("keptDuration", () => {
  it("sums segment durations", () => {
    const segs = [{ in: 0, out: 3 }, { in: 5, out: 8 }];
    expect(keptDuration(segs)).toBeCloseTo(6);
  });

  it("returns 0 for an empty array", () => {
    expect(keptDuration([])).toBe(0);
  });

  it("ignores inverted segments (out < in)", () => {
    expect(keptDuration([{ in: 5, out: 3 }])).toBe(0);
  });
});

describe("formatTime", () => {
  it("formats 0 as 0:00.0", () => {
    expect(formatTime(0)).toBe("0:00.0");
  });

  it("formats 65.5s as 1:05.5", () => {
    expect(formatTime(65.5)).toBe("1:05.5");
  });

  it("formats 3661s as 61:01.0", () => {
    expect(formatTime(3661)).toBe("61:01.0");
  });

  it("clamps negative to 0:00.0", () => {
    expect(formatTime(-1)).toBe("0:00.0");
  });

  it("clamps NaN to 0:00.0", () => {
    expect(formatTime(NaN)).toBe("0:00.0");
  });

  it("tenths digit: 1.15s → 0:01.1", () => {
    expect(formatTime(1.15)).toBe("0:01.1");
  });
});

describe("MIN_SEG", () => {
  it("is 0.1 seconds", () => {
    expect(MIN_SEG).toBe(0.1);
  });
});
