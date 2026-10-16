/** Audio is the master clock when recording sound. Video may drop frames under
 * load; it must not drift ahead by using a different clock from the samples. */
export function recordingTimestampUs(
  wallSeconds: number,
  audioSeconds: number | null,
  previousTimestampUs = -1,
): number | null {
  const timestamp = Math.max(
    0,
    Math.round((audioSeconds ?? wallSeconds) * 1_000_000),
  );
  return timestamp > previousTimestampUs ? timestamp : null;
}
