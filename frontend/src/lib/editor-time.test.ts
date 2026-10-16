import { describe, expect, it } from "vitest";
import {
  frameTick,
  integer,
  seconds,
  tickAtSeconds,
  timecode,
  TICKS_PER_SECOND,
} from "./editor-time";
describe("editor time", () => {
  it("keeps ten-hour NTSC frame positions exact", () => {
    const rate = { num: "30000", den: "1001" };
    const a = frameTick(1_080_000n, rate),
      b = frameTick(1_080_001n, rate);
    expect(b - a).toBe((TICKS_PER_SECOND * 1001n) / 30000n);
    expect(integer(a).$integer).toBe(a.toString());
  });
  it("formats NTSC drop-frame boundaries and non-drop frame counts", () => {
    const rate = { num: "30000", den: "1001" };
    expect(timecode(frameTick(1800n, rate), rate, true)).toBe("00:01:00;02");
    expect(timecode(frameTick(17982n, rate), rate, true)).toBe("00:10:00;00");
    expect(timecode(frameTick(108000n, rate), rate)).toBe("01:00:00:00");
  });
  it("formats and maps display positions", () => {
    expect(timecode(tickAtSeconds(3661.5))).toBe("01:01:01:15");
    expect(seconds(tickAtSeconds(3661.5))).toBe(3661.5);
    expect(() => frameTick(1n, { num: "0", den: "1" })).toThrow();
  });
});
