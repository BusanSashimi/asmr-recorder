import { describe, it, expect } from "vitest";
import { encodeQueueLimit } from "./encoder-tuning";

describe("encodeQueueLimit", () => {
  it("returns 4 at 1080p/30 (reference point)", () => {
    expect(encodeQueueLimit(1920, 1080, 30)).toBe(4);
  });

  it("clamps to 3 at 720p/30 (low-cost encode)", () => {
    // raw scaled = Math.round(4 * 0.444) = 2 → clamped to 3
    expect(encodeQueueLimit(1280, 720, 30)).toBe(3);
  });

  it("clamps to 8 at 4K/30 (high-cost encode)", () => {
    // raw scaled = Math.round(4 * 4.0) = 16 → clamped to 8
    expect(encodeQueueLimit(3840, 2160, 30)).toBe(8);
  });

  it("never returns below 3 (min clamp)", () => {
    expect(encodeQueueLimit(1, 1, 1)).toBe(3);
  });

  it("never returns above 8 (max clamp)", () => {
    expect(encodeQueueLimit(99999, 99999, 120)).toBe(8);
  });

  it("is monotonically non-decreasing with pixel throughput", () => {
    const limit720 = encodeQueueLimit(1280, 720, 30);
    const limit1080 = encodeQueueLimit(1920, 1080, 30);
    const limit1440 = encodeQueueLimit(2560, 1440, 30);
    expect(limit1080).toBeGreaterThanOrEqual(limit720);
    expect(limit1440).toBeGreaterThanOrEqual(limit1080);
  });

  it("scales with fps at the same resolution", () => {
    const limit30 = encodeQueueLimit(1920, 1080, 30);
    const limit60 = encodeQueueLimit(1920, 1080, 60);
    expect(limit60).toBeGreaterThanOrEqual(limit30);
  });
});
