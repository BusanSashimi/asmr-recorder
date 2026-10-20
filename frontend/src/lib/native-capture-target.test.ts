import { describe, expect, it } from "vitest";
import { nativeCaptureTarget } from "./native-capture-target";
import { defaultExternalRecordingConfig } from "@/types/recording";

const profile = { ...defaultExternalRecordingConfig, outputWidth: 2560, outputHeight: 1440 };
const geometry = { width: 2560, height: 1440, pointPixelScale: 1 };
describe("native capture sample requirements", () => {
  it("uses the output slot rather than a universal half-width limit", () => {
    expect(nativeCaptureTarget(0, geometry, undefined, profile)).toEqual({ width: 1280, height: 720 });
    expect(nativeCaptureTarget(0, geometry, undefined, { ...profile, layout: "solo" })).toEqual({ width: 2560, height: 1440 });
    expect(nativeCaptureTarget(0, geometry, undefined, { ...profile, layout: "pip" })).toEqual({ width: 2560, height: 1440 });
    expect(nativeCaptureTarget(1, geometry, undefined, { ...profile, layout: "pip", pipSize: 0.25 })).toEqual({ width: 640, height: 360 });
    expect(nativeCaptureTarget(0, geometry, undefined, { ...profile, layout: "side-by-side" })).toEqual({ width: 2560, height: 1440 });
  });
  it("preserves portrait/ultrawide detail required by cover and caps physical pixels", () => {
    expect(nativeCaptureTarget(0, { width: 1080, height: 1920, pointPixelScale: 1 }, undefined, profile)).toEqual({ width: 1080, height: 1920 });
    expect(nativeCaptureTarget(0, { width: 3440, height: 1440, pointPixelScale: 1 }, undefined, profile)).toEqual({ width: 1720, height: 720 });
    const crop = { x: 100, y: 100, width: 800, height: 450 };
    expect(nativeCaptureTarget(0, { ...geometry, pointPixelScale: 2 }, crop, profile)).toEqual({ width: 1280, height: 720 });
    expect(nativeCaptureTarget(0, geometry, crop, profile)).toEqual({ width: 800, height: 450 });
  });
  it("omits hidden sections, rounds fractional pixels up, and rejects invalid crops", () => {
    expect(nativeCaptureTarget(1, geometry, undefined, { ...profile, layout: "solo" })).toBeNull();
    expect(nativeCaptureTarget(0, geometry, undefined, { ...profile, outputWidth: 2559, outputHeight: 1439 })).toEqual({ width: 1280, height: 720 });
    expect(() => nativeCaptureTarget(0, geometry, { x: 2560, y: 0, width: 1, height: 1 }, profile)).toThrow();
  });
});
