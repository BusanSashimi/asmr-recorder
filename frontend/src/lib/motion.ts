// §5 motion presets

export const spring = {
  // §4 default: critically damped, no overshoot
  default:  { type: 'spring', bounce: 0, duration: 0.35 },
  snappy:   { type: 'spring', bounce: 0, duration: 0.25 },   // chips, small state swaps
  // §4 momentum: ONLY after a drag release that carried velocity
  momentum: { type: 'spring', bounce: 0.2, duration: 0.4 },
} as const

export const ease = { out: [0.32, 0.72, 0, 1] as const } // iOS sheet curve for CSS/opacity

// §9 rubber-band: progressive resistance at edges
export function rubberband(overshoot: number, dimension: number, c = 0.55): number {
  return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot))
}
