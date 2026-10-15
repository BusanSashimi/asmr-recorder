import { useEffect, useRef } from "react";

/**
 * Live audio-monitor graphics for the monitor strip.
 *
 * Both components read an AnalyserNode on a throttled (~30fps) rAF loop and draw
 * to a canvas. They render an idle state when no analyser is available (mic off
 * or unavailable) so the section never looks broken.
 *
 * Colors are read from CSS custom properties so they follow the app theme. The
 * matchMedia listener for prefers-color-scheme re-reads them when the OS theme
 * changes without requiring a full re-mount.
 */

const DRAW_INTERVAL_MS = 33; // ~30fps — keep main-thread cost low during record
const SPECTRUM_BARS = 56; // log-spaced FFT bars drawn across the lane
const METER_FLOOR_DB = -60; // bottom of the meter scale
const CLIP_THRESHOLD = 0.99; // linear peak that lights the clip indicator

// Normalized dBFS thresholds matching spec meter zones:
//   success  < -12 dBFS (norm 0.80) ≤ warning < -3 dBFS (norm 0.95) ≤ record
const THRESH_WARNING = ((-12 - METER_FLOOR_DB) / (0 - METER_FLOOR_DB)); // 0.80
const THRESH_RECORD = ((-3 - METER_FLOOR_DB) / (0 - METER_FLOOR_DB));   // 0.95

const ampToNorm = (amp: number): number => {
  if (amp <= 0) return 0;
  const db = 20 * Math.log10(amp);
  return Math.min(1, Math.max(0, (db - METER_FLOOR_DB) / (0 - METER_FLOOR_DB)));
};

const rms = (buf: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
};

const peak = (buf: Float32Array): number => {
  let max = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > max) max = a;
  }
  return max;
};

interface ThemeColors {
  fill: string;
  success: string;
  successFaint: string;
  warning: string;
  record: string;
  mutedFg: string;
}

const readThemeColors = (): ThemeColors => {
  const cs = getComputedStyle(document.documentElement);
  const get = (p: string) => cs.getPropertyValue(p).trim();
  return {
    fill: `hsl(${get("--fill")})`,
    success: `hsl(${get("--success")})`,
    successFaint: `hsl(${get("--success")} / 0.06)`,
    warning: `hsl(${get("--warning")})`,
    record: `hsl(${get("--record")})`,
    mutedFg: `hsl(${get("--muted-foreground")})`,
  };
};

interface StereoMeterProps {
  analyserL: AnalyserNode | null;
  analyserR: AnalyserNode | null;
  className?: string;
}

/** Compact two-bar (L/R) level meter with peak-hold and a clip indicator. */
export function StereoMeter({ analyserL, analyserR, className }: StereoMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // DPR-aware: buffer = CSS size × devicePixelRatio; drawing math stays in CSS px.
    const CSS_W = 14;
    const CSS_H = 30;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(CSS_W * dpr);
    canvas.height = Math.round(CSS_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = CSS_W;
    const H = CSS_H;
    const gap = 2;
    const barW = (W - gap) / 2;

    let colors = readThemeColors();
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onThemeChange = () => { colors = readThemeColors(); };
    mql.addEventListener("change", onThemeChange);

    const levelColor = (norm: number): string => {
      if (norm > THRESH_RECORD) return colors.record;
      if (norm > THRESH_WARNING) return colors.warning;
      return colors.success;
    };

    const bufL = analyserL ? new Float32Array(analyserL.fftSize) : null;
    const bufR = analyserR ? new Float32Array(analyserR.fftSize) : null;
    const hold: [number, number] = [0, 0];
    let raf = 0;
    let last = 0;

    const drawBar = (x: number, level: number, peakHold: number, clip: boolean) => {
      ctx.fillStyle = colors.fill;
      ctx.fillRect(x, 0, barW, H);
      const h = level * H;
      ctx.fillStyle = clip ? colors.record : levelColor(level);
      ctx.fillRect(x, H - h, barW, h);
      if (peakHold > 0.01) {
        const py = H - peakHold * H;
        ctx.fillStyle = peakHold > THRESH_RECORD ? colors.record : colors.mutedFg;
        ctx.fillRect(x, Math.min(H - 1, py), barW, 1);
      }
    };

    const render = (t: number) => {
      raf = requestAnimationFrame(render);
      if (t - last < DRAW_INTERVAL_MS) return;
      last = t;

      ctx.clearRect(0, 0, W, H);
      const levels: [number, number] = [0, 0];
      const peaks: [number, number] = [0, 0];
      if (analyserL && bufL) {
        analyserL.getFloatTimeDomainData(bufL);
        levels[0] = ampToNorm(rms(bufL));
        peaks[0] = peak(bufL);
      }
      if (analyserR && bufR) {
        analyserR.getFloatTimeDomainData(bufR);
        levels[1] = ampToNorm(rms(bufR));
        peaks[1] = peak(bufR);
      }
      for (let i = 0; i < 2; i++) {
        const peakNorm = ampToNorm(peaks[i]);
        hold[i] = Math.max(peakNorm, hold[i] - 0.015); // slow decay
        drawBar(i * (barW + gap), levels[i], hold[i], peaks[i] >= CLIP_THRESHOLD);
      }
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      mql.removeEventListener("change", onThemeChange);
    };
  }, [analyserL, analyserR]);

  return (
    <canvas
      ref={canvasRef}
      width={14}
      height={30}
      style={{ width: 14, height: 30 }}
      className={className}
      title="Input level (L / R)"
    />
  );
}

interface SpectrumProps {
  analyser: AnalyserNode | null;
  className?: string;
}

/** Log-frequency spectrum (FFT bars) of the current mic input. */
export function Spectrum({ analyser, className }: SpectrumProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    // Size the drawing buffer to the lane's actual pixel size (DPR-aware). A
    // <canvas> defaults to a 300x150 buffer regardless of CSS, so without this
    // the bars are drawn off the visible area and the lane looks empty.
    let W = 0;
    let H = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round((canvas.clientWidth || 600) * dpr);
      canvas.height = Math.round((canvas.clientHeight || 48) * dpr);
      W = canvas.width;
      H = canvas.height;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let colors = readThemeColors();
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const drawBase = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = colors.successFaint;
      ctx.fillRect(0, 0, W, H);
    };

    if (!analyser) {
      drawBase();
      const onThemeChange = () => { colors = readThemeColors(); drawBase(); };
      mql.addEventListener("change", onThemeChange);
      return () => {
        ro.disconnect();
        mql.removeEventListener("change", onThemeChange);
      };
    }

    const buf = new Uint8Array(analyser.frequencyBinCount);
    const onThemeChange = () => { colors = readThemeColors(); };
    mql.addEventListener("change", onThemeChange);

    // Log-spaced bin edges (skipping DC at bin 0) so low frequencies, where most
    // ASMR energy lives, get more bars than the sparse high end.
    const edges: number[] = [];
    for (let i = 0; i <= SPECTRUM_BARS; i++) {
      edges.push(
        Math.min(buf.length, Math.floor(Math.pow(buf.length, i / SPECTRUM_BARS))),
      );
    }

    let raf = 0;
    let last = 0;
    const render = (t: number) => {
      raf = requestAnimationFrame(render);
      if (t - last < DRAW_INTERVAL_MS) return;
      last = t;

      analyser.getByteFrequencyData(buf); // 0..255, dB-scaled by the analyser
      drawBase();

      const gap = Math.max(1, Math.round(window.devicePixelRatio || 1));
      const barW = W / SPECTRUM_BARS;
      for (let b = 0; b < SPECTRUM_BARS; b++) {
        const lo = edges[b];
        const hi = Math.max(lo + 1, edges[b + 1]);
        let max = 0;
        for (let k = lo; k < hi && k < buf.length; k++) {
          if (buf[k] > max) max = buf[k];
        }
        const norm = max / 255;
        const h = norm * H;
        ctx.fillStyle =
          norm > 0.85 ? colors.record : norm > 0.6 ? colors.warning : colors.success;
        ctx.fillRect(b * barW, H - h, Math.max(1, barW - gap), h);
      }
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mql.removeEventListener("change", onThemeChange);
    };
  }, [analyser]);

  return (
    <canvas ref={canvasRef} className={className} title="Live input spectrum" />
  );
}
