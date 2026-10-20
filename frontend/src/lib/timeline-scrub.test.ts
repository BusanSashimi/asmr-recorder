import { describe, expect, it } from "vitest";
import { frameTick, tickAtSeconds } from "./editor-time";
import { timelineScrubTime } from "./timeline-scrub";

const rate = { num: "30", den: "1" };

describe("timeline scrubbing", () => {
  it("maps viewport positions without adding the scroll offset twice", () => {
    expect(timelineScrubTime(580, 100, 1200, 60, rate))
      .toBe(tickAtSeconds(8).toString());
    // Scrolling the same ruler 300px left moves its viewport rectangle.
    expect(timelineScrubTime(280, -200, 1200, 60, rate))
      .toBe(tickAtSeconds(8).toString());
  });

  it("uses the current zoom and rounds to the nearest frame", () => {
    expect(timelineScrubTime(961.2, 0, 2400, 120, rate))
      .toBe(frameTick(240n, rate).toString());
    expect(timelineScrubTime(962.4, 0, 2400, 120, rate))
      .toBe(frameTick(241n, rate).toString());
  });

  it("clamps captured drags outside both ends, including the padded tail", () => {
    expect(timelineScrubTime(-100, 112, 1380, 60, rate)).toBe("0");
    expect(timelineScrubTime(9000, 112, 1380, 60, rate))
      .toBe(tickAtSeconds(23).toString());
    // The minimum ruler width also remains seekable at low zoom.
    expect(timelineScrubTime(600, 0, 500, 10, rate))
      .toBe(tickAtSeconds(50).toString());
  });

  it("preserves fractional-rate ticks and stays inside a partial final frame", () => {
    const ntsc = { num: "30000", den: "1001" };
    expect(timelineScrubTime(480, 0, 1200, 60, ntsc))
      .toBe(frameTick(240n, ntsc).toString());
    expect(timelineScrubTime(9000, 0, 601, 60, ntsc))
      .toBe(frameTick(300n, ntsc).toString());
  });

  it("keeps long-session positions exact without converting full ticks to Number", () => {
    const ntsc = { num: "30000", den: "1001" };
    expect(timelineScrubTime(36000 * 60, 0, 36010 * 60, 60, ntsc))
      .toBe(frameTick(1_078_921n, ntsc).toString());
  });
});
