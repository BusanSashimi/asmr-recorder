export const TICKS_PER_SECOND = 254_016_000_000n;
export const integer = (value: string | bigint) => ({
  $integer: String(value),
});
export function seconds(ticks: string | bigint): number {
  const t = BigInt(ticks);
  return (
    Number(t / TICKS_PER_SECOND) +
    Number(t % TICKS_PER_SECOND) / Number(TICKS_PER_SECOND)
  );
}
export function frameTick(
  frame: bigint,
  rate: { num: string; den: string },
): bigint {
  const n = BigInt(rate.num),
    d = BigInt(rate.den);
  if (n <= 0n || d <= 0n) throw new Error("Invalid frame rate");
  return (frame * TICKS_PER_SECOND * d) / n;
}
export function tickAtSeconds(value: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const whole = Math.trunc(value);
  return (
    BigInt(whole) * TICKS_PER_SECOND +
    BigInt(Math.round((value - whole) * Number(TICKS_PER_SECOND)))
  );
}
export function timecode(
  ticks: string | bigint,
  rate = { num: "30", den: "1" },
  dropFrame = false,
): string {
  const t = BigInt(ticks) < 0n ? 0n : BigInt(ticks),
    num = BigInt(rate.num),
    den = BigInt(rate.den);
  if (num <= 0n || den <= 0n) return "00:00:00:00";
  const fps = (num + den / 2n) / den;
  let frames = (t * num) / (TICKS_PER_SECOND * den);
  const ntsc = den === 1001n && (num === 30000n || num === 60000n);
  if (dropFrame && ntsc) {
    const drop = fps === 60n ? 4n : 2n,
      ten = fps * 600n - drop * 9n,
      minute = fps * 60n - drop;
    const blocks = frames / ten,
      remainder = frames % ten;
    frames +=
      drop * 9n * blocks +
      (remainder >= drop ? drop * ((remainder - drop) / minute) : 0n);
  }
  const parts = [
    frames / (fps * 3600n),
    (frames / (fps * 60n)) % 60n,
    (frames / fps) % 60n,
    frames % fps,
  ].map((n) => n.toString().padStart(2, "0"));
  return (
    parts.slice(0, 3).join(":") + (dropFrame && ntsc ? ";" : ":") + parts[3]
  );
}
