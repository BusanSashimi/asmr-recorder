import { frameTick, tickAtSeconds, TICKS_PER_SECOND } from "./editor-time";

// The ruler's viewport rectangle already includes horizontal scrolling.
export function timelineScrubTime(
  clientX: number,
  left: number,
  width: number,
  zoom: number,
  rate: { num: string; den: string },
): string {
  const end = tickAtSeconds(width / zoom);
  const at = tickAtSeconds(Math.max(0, Math.min(width, clientX - left)) / zoom);
  const num = BigInt(rate.num), frame = TICKS_PER_SECOND * BigInt(rate.den);
  const nearest = (at * num + frame / 2n) / frame;
  const last = end * num / frame;
  return frameTick(nearest > last ? last : nearest, rate).toString();
}
