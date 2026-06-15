import { describe, it, expect } from "vitest";
import {
  splitSegment,
  keptDuration,
  formatTime,
  MIN_SEG,
  rebaseTimestamp,
  keepAudioPacket,
} from "./trim-segments";

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

describe("rebaseTimestamp", () => {
  it("maps the anchor to segOffset (output origin of the segment)", () => {
    expect(rebaseTimestamp(5, 5, 0)).toBe(0);
    expect(rebaseTimestamp(5, 5, 12)).toBe(12);
  });

  it("preserves relative spacing from the anchor", () => {
    // a packet 0.5s after the anchor lands 0.5s after segOffset
    expect(rebaseTimestamp(5.5, 5, 12)).toBeCloseTo(12.5);
  });

  it("can produce a negative timestamp when src precedes the anchor", () => {
    // the AAC packet straddling a frame-accurate in-point starts before it;
    // mediabunny tolerates the negative start (normalizes to media-time 0).
    expect(rebaseTimestamp(4.98, 5, 0)).toBeCloseTo(-0.02);
  });

  it("Bug A regression: frame-accurate audio (anchor=seg.in) aligns with video, not the keyframe", () => {
    // Video re-anchors to seg.in; before the fix, audio used `origin` (the keyframe
    // up to one ~3s GOP earlier), so audio was misaligned by (seg.in - origin).
    const segIn = 8.0;
    const segOffset = 0;
    const videoFirstTs = rebaseTimestamp(segIn, segIn, segOffset); // re-encoded GOP starts at seg.in
    const keyframeOrigin = 5.0; // 3s earlier — the OLD audio anchor
    const audioStraddleStart = 7.99; // packet straddling seg.in
    const fixedAudioTs = rebaseTimestamp(audioStraddleStart, segIn, segOffset);
    // fixed: audio lands within one packet (~21ms) of the video cut frame
    expect(Math.abs(fixedAudioTs - videoFirstTs)).toBeLessThan(0.025);
    // for the SAME packet, the buggy origin-anchor placed it exactly (seg.in - origin)
    // later — that offset IS the ~3s desync the fix removes.
    const buggyAudioTs = rebaseTimestamp(audioStraddleStart, keyframeOrigin, segOffset);
    expect(buggyAudioTs - fixedAudioTs).toBeCloseTo(segIn - keyframeOrigin); // ~3s
  });
});

describe("keepAudioPacket", () => {
  const segIn = 8.0;
  const dur = 0.0213; // one AAC packet @ 48kHz (1024 samples)

  it("drops a packet that ends entirely before seg.in", () => {
    expect(keepAudioPacket(7.95, dur, segIn)).toBe(false); // ends at ~7.971 < 8.0
  });

  it("keeps the packet straddling seg.in (its end crosses the in-point)", () => {
    expect(keepAudioPacket(7.99, dur, segIn)).toBe(true); // ends at ~8.011 > 8.0
  });

  it("keeps a packet that starts at or after seg.in", () => {
    expect(keepAudioPacket(8.0, dur, segIn)).toBe(true);
    expect(keepAudioPacket(8.5, dur, segIn)).toBe(true);
  });

  it("treats an unknown (0) duration as a point at pktStart", () => {
    // with no duration, only packets strictly after seg.in survive
    expect(keepAudioPacket(7.99, 0, segIn)).toBe(false);
    expect(keepAudioPacket(8.01, 0, segIn)).toBe(true);
  });
});
