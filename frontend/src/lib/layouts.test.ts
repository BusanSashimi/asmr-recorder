import { describe, it, expect } from "vitest";
import { computeSlots } from "./layouts";
import type { PipPosition } from "@/types/recording";

describe("computeSlots", () => {
  it("grid-2x2: 4 slots using all sections, fill fit", () => {
    const slots = computeSlots("grid-2x2");
    expect(slots).toHaveLength(4);
    for (const s of slots) {
      expect(s.w).toBe(0.5);
      expect(s.h).toBe(0.5);
      expect(s.fit).toBe("fill");
    }
    // Each quadrant covered
    const positions = slots.map((s) => `${s.x},${s.y}`);
    expect(positions).toContain("0,0");
    expect(positions).toContain("0.5,0");
    expect(positions).toContain("0,0.5");
    expect(positions).toContain("0.5,0.5");
  });

  it("grid-2x2: tiles cover the full [0,1]×[0,1] frame without overlap", () => {
    const slots = computeSlots("grid-2x2");
    // Total area should equal 1.0
    const total = slots.reduce((sum, s) => sum + s.w * s.h, 0);
    expect(total).toBeCloseTo(1.0);
  });

  it("solo: 1 full-frame slot with cover fit", () => {
    const slots = computeSlots("solo");
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ section: 0, x: 0, y: 0, w: 1, h: 1, fit: "cover" });
  });

  it("side-by-side: 2 half-width full-height slots with cover fit", () => {
    const slots = computeSlots("side-by-side");
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ section: 0, x: 0, y: 0, w: 0.5, h: 1, fit: "cover" });
    expect(slots[1]).toMatchObject({ section: 1, x: 0.5, y: 0, w: 0.5, h: 1, fit: "cover" });
  });

  it("pip: background drawn first (z-order), overlay drawn last", () => {
    const slots = computeSlots("pip", { pipPosition: "top-right", pipSize: 0.25 });
    expect(slots).toHaveLength(2);
    // Background is slot[0] → drawn first → behind
    expect(slots[0]).toMatchObject({ section: 0, x: 0, y: 0, w: 1, h: 1, fit: "cover" });
    // Overlay is slot[1] → drawn last → on top
    expect(slots[1].section).toBe(1);
    expect(slots[1].fit).toBe("cover");
  });

  it("pip: all four corner positions stay inside the [0,1] frame", () => {
    const corners: PipPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
    for (const pos of corners) {
      const slots = computeSlots("pip", { pipPosition: pos, pipSize: 0.25 });
      const overlay = slots[1];
      expect(overlay.x).toBeGreaterThanOrEqual(0);
      expect(overlay.y).toBeGreaterThanOrEqual(0);
      expect(overlay.x + overlay.w).toBeLessThanOrEqual(1);
      expect(overlay.y + overlay.h).toBeLessThanOrEqual(1);
    }
  });

  it("pip: top-right corner is in the right half and top area", () => {
    const slots = computeSlots("pip", { pipPosition: "top-right", pipSize: 0.25 });
    const overlay = slots[1];
    expect(overlay.x).toBeGreaterThan(0.5);
    expect(overlay.y).toBeLessThan(0.5);
  });

  it("pip: bottom-left corner is in the left half and bottom area", () => {
    const slots = computeSlots("pip", { pipPosition: "bottom-left", pipSize: 0.25 });
    const overlay = slots[1];
    expect(overlay.x).toBeLessThan(0.5);
    expect(overlay.y).toBeGreaterThan(0.5);
  });

  it("pip: pixel coords fit inside a 1920×1080 frame for all corners", () => {
    const W = 1920, H = 1080;
    const corners: PipPosition[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
    for (const pos of corners) {
      const slots = computeSlots("pip", { pipPosition: pos, pipSize: 0.25 });
      const o = slots[1];
      expect(o.x * W + o.w * W).toBeLessThanOrEqual(W);
      expect(o.y * H + o.h * H).toBeLessThanOrEqual(H);
    }
  });
});
