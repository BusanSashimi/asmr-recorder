import type { PipPosition, LayoutType } from "@/types/recording";

export type { LayoutType };

export interface LayoutSlot {
  section: number;
  x: number;
  y: number;
  w: number;
  h: number;
  fit: "fill" | "cover";
}

export interface LayoutOpts {
  pipPosition?: PipPosition;
  pipSize?: number;
}

export const LAYOUT_LABELS: Record<LayoutType, string> = {
  "grid-2x2": "2×2 Grid",
  solo: "Solo / Fullscreen",
  "side-by-side": "Side-by-Side",
  pip: "Picture-in-Picture",
};

// Slot order = draw order = z-order: first slot is drawn behind, last is on top.
// All coordinates are normalized 0..1 so the same data drives both Canvas pixels
// (×outputWidth/Height) and preview CSS (×100%).
export function computeSlots(
  layout: LayoutType,
  opts: LayoutOpts = {},
): LayoutSlot[] {
  switch (layout) {
    case "grid-2x2":
      return [
        { section: 0, x: 0,   y: 0,   w: 0.5, h: 0.5, fit: "fill" },
        { section: 1, x: 0.5, y: 0,   w: 0.5, h: 0.5, fit: "fill" },
        { section: 2, x: 0,   y: 0.5, w: 0.5, h: 0.5, fit: "fill" },
        { section: 3, x: 0.5, y: 0.5, w: 0.5, h: 0.5, fit: "fill" },
      ];
    case "solo":
      return [{ section: 0, x: 0, y: 0, w: 1, h: 1, fit: "cover" }];
    case "side-by-side":
      return [
        { section: 0, x: 0,   y: 0, w: 0.5, h: 1, fit: "cover" },
        { section: 1, x: 0.5, y: 0, w: 0.5, h: 1, fit: "cover" },
      ];
    case "pip": {
      const s = opts.pipSize ?? 0.25;
      const m = 0.025;
      const pos = opts.pipPosition ?? "top-right";
      const x = pos.endsWith("left")  ? m : 1 - s - m;
      const y = pos.startsWith("top") ? m : 1 - s - m;
      return [
        { section: 0, x: 0, y: 0, w: 1, h: 1, fit: "cover" },
        { section: 1, x, y, w: s, h: s, fit: "cover" },
      ];
    }
  }
}
