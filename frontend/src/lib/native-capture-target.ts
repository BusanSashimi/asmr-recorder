import { computeSlots } from "./layouts";
import type { ExternalRecordingConfig, ScreenRegion } from "@/types/recording";
import type { DisplayGeometry } from "./native-screen";

export type CaptureProfile = Pick<ExternalRecordingConfig,
  "outputWidth" | "outputHeight" | "frameRate" | "layout" | "pipPosition" | "pipSize">;
export interface CaptureTarget { width: number; height: number }

export function captureProfileKey(profile: CaptureProfile): string {
  return JSON.stringify([profile.outputWidth, profile.outputHeight, profile.frameRate ?? 30,
    profile.layout, profile.pipPosition, profile.pipSize]);
}

/** Keep source aspect and enough samples for both fill and cover composition. */
export function nativeCaptureTarget(section: number, geometry: DisplayGeometry,
  region: ScreenRegion | undefined, profile: CaptureProfile): CaptureTarget | null {
  const slots = computeSlots(profile.layout, profile).filter(slot => slot.section === section);
  if (!slots.length) return null;
  const width = Math.min(region?.width ?? geometry.width, geometry.width - (region?.x ?? 0));
  const height = Math.min(region?.height ?? geometry.height, geometry.height - (region?.y ?? 0));
  if (width <= 0 || height <= 0 || !Number.isFinite(geometry.pointPixelScale) || geometry.pointPixelScale <= 0) {
    throw new Error("The capture region is outside the selected display.");
  }
  const required = Math.max(...slots.map(slot => Math.max(
    Math.ceil(slot.w * profile.outputWidth) / width,
    Math.ceil(slot.h * profile.outputHeight) / height,
  )));
  const scale = Math.min(geometry.pointPixelScale, required);
  return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)) };
}
