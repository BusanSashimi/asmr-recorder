/** A keep-range within the clip (seconds, in < out). */
export type Segment = { in: number; out: number };

/** Minimum segment duration in seconds. Shorter segments are dropped. */
export const MIN_SEG = 0.1;

/** Format seconds as mm:ss.t */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const t = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${t}`;
}

/**
 * Remove the range [cutIn, cutOut] from `seg`, returning 0-2 replacement segments.
 * Replacement segments shorter than `minSeg` are dropped.
 */
export function splitSegment(
  seg: Segment,
  cutIn: number,
  cutOut: number,
  minSeg = MIN_SEG,
): Segment[] {
  const result: Segment[] = [];
  if (cutIn - seg.in > minSeg) result.push({ in: seg.in, out: cutIn });
  if (seg.out - cutOut > minSeg) result.push({ in: cutOut, out: seg.out });
  return result;
}

/** Sum of all segment durations in seconds. */
export function keptDuration(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.out - s.in), 0);
}

/** Rebase a source-clip packet timestamp onto the continuous output timeline. */
export function rebaseTimestamp(
  srcTs: number,
  anchor: number,
  segOffset: number,
): number {
  return srcTs - anchor + segOffset;
}

/**
 * Should this audio packet be kept given a frame-accurate in-point?
 *
 * AAC packets are ~21 ms (1024 samples @ 48 kHz) and can't be sub-trimmed without
 * re-encoding, so we keep the first packet whose END crosses `segIn` (accepting up
 * to ~one packet of pre-roll) and drop packets that end entirely before `segIn`.
 */
export function keepAudioPacket(
  pktStart: number,
  pktDuration: number,
  segIn: number,
): boolean {
  return pktStart + pktDuration > segIn;
}
