/** Convert a linear gain multiplier to a dB string for display.
 *  Zero or negative gain returns "−∞". */
export function gainToDb(gain: number): string {
  if (gain <= 0) return "−∞"; // "−∞"
  return (20 * Math.log10(gain)).toFixed(1) + " dB";
}
