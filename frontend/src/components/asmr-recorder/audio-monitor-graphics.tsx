import { useEffect, useRef } from "react";

/**
 * Live audio-monitor graphics for the timeline's Audio Track section.
 *
 * Both components read an AnalyserNode on a throttled (~30fps) rAF loop and draw
 * to a canvas. They render an idle state when no analyser is available (mic off
 * or unavailable) so the section never looks broken.
 */

const DRAW_INTERVAL_MS = 33; // ~30fps — keep main-thread cost low during record
const METER_FLOOR_DB = -60; // bottom of the meter scale
const CLIP_THRESHOLD = 0.99; // linear peak that lights the clip indicator

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

/** Color for a normalized level: green → amber → red near the top. */
const levelColor = (norm: number): string => {
  if (norm > 0.92) return "#ef4444"; // red (hot)
  if (norm > 0.75) return "#f59e0b"; // amber
  return "#22c55e"; // green
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

    const W = canvas.width;
    const H = canvas.height;
    const gap = 2;
    const barW = (W - gap) / 2;

    const bufL = analyserL ? new Float32Array(analyserL.fftSize) : null;
    const bufR = analyserR ? new Float32Array(analyserR.fftSize) : null;
    // [rmsNorm, peakHoldNorm, clipFlag] per channel
    const hold: [number, number] = [0, 0];
    let raf = 0;
    let last = 0;

    const drawBar = (x: number, level: number, peakHold: number, clip: boolean) => {
      ctx.fillStyle = "#27272a"; // track background
      ctx.fillRect(x, 0, barW, H);
      const h = level * H;
      ctx.fillStyle = clip ? "#ef4444" : levelColor(level);
      ctx.fillRect(x, H - h, barW, h);
      if (peakHold > 0.01) {
        const py = H - peakHold * H;
        ctx.fillStyle = peakHold > 0.92 ? "#ef4444" : "#a1a1aa";
        ctx.fillRect(x, Math.min(H - 1, py), barW, 1.5);
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
    return () => cancelAnimationFrame(raf);
  }, [analyserL, analyserR]);

  return (
    <canvas
      ref={canvasRef}
      width={14}
      height={30}
      className={className}
      title="Input level (L / R)"
    />
  );
}

interface LiveWaveformProps {
  analyser: AnalyserNode | null;
  className?: string;
}

/** Live oscilloscope of the current mic input, stretched across the lane. */
export function LiveWaveform({ analyser, className }: LiveWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const buf = analyser ? new Uint8Array(analyser.fftSize) : null;
    let raf = 0;
    let last = 0;

    const drawIdle = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#3f3f46";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
    };

    if (!analyser || !buf) {
      drawIdle();
      return;
    }

    const render = (t: number) => {
      raf = requestAnimationFrame(render);
      if (t - last < DRAW_INTERVAL_MS) return;
      last = t;

      analyser.getByteTimeDomainData(buf);
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = W / buf.length;
      for (let i = 0; i < buf.length; i++) {
        // getByteTimeDomainData: 0..255 with 128 = silence. Recenter explicitly
        // so silence is always mid-height regardless of rounding.
        const y = H / 2 + ((buf[i] - 128) / 128) * (H / 2);
        const x = i * step;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={48}
      className={className}
      title="Live input waveform"
    />
  );
}
