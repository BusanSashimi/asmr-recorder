import { expect, it } from "vitest";
import { recordingTimestampUs } from "./recording-clock";

it("keeps video on the sample clock when audio rendering falls behind wall time", () => {
  // Observed WKWebView capture: 15.318s wall time, 13.776s of audio samples.
  expect(recordingTimestampUs(15.318, 13.776)).toBe(13_776_000);
});
it("uses wall time for video-only recording and clamps initialization skew", () => {
  expect(recordingTimestampUs(15.318, null)).toBe(15_318_000);
  expect(recordingTimestampUs(0.1, -0.002)).toBe(0);
});

it("drops repeated or regressing clock values instead of producing duplicate video timestamps", () => {
  // A real capture produced repeated packet timestamps at 0 and 0.197326s.
  expect(recordingTimestampUs(0.016, 0, 0)).toBeNull();
  expect(recordingTimestampUs(0.248, 0.197326, 197_326)).toBeNull();
  expect(recordingTimestampUs(0.281, 0.19, 197_326)).toBeNull();
  expect(recordingTimestampUs(0.314, 0.232, 197_326)).toBe(232_000);
});
