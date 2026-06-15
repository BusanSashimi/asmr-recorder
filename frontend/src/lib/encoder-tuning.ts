// Returns the max WebCodecs encoder queue depth before backpressure kicks in.
// Scales with pixel throughput: cheap encodes (720p/30) get a tighter queue so
// we drop early; expensive encodes (4K/30) get more headroom. Clamped to [3, 8].
export function encodeQueueLimit(
  width: number,
  height: number,
  fps: number,
): number {
  const pixelsPerSec = width * height * fps;
  const hd1080_30 = 1920 * 1080 * 30;
  const scaled = Math.round(4 * (pixelsPerSec / hd1080_30));
  return Math.min(8, Math.max(3, scaled));
}
