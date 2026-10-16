import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Peaks = [number, number][];
const cache = new Map<string, Peaks>();
// Small bounded cache shared by source monitors and visible timeline clips.
export function Waveform({
  item,
  start,
  duration,
  stream = 0,
  revision,
  reverse = false,
  gain = 0,
}: {
  item: string;
  start: string;
  duration: string;
  stream?: number;
  revision: string;
  reverse?: boolean;
  gain?: number;
}) {
  const key = `${revision}:${item}:${stream}:${start}:${duration}`;
  const [result, setResult] = useState<{
    key: string;
    peaks?: Peaks;
    error?: string;
  }>();
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const request = async () => {
      try {
        const peaks =
          cache.get(key) ??
          (await invoke<Peaks>("editor_waveform", {
            item,
            start,
            duration,
            stream,
            bins: 512,
          }));
        if (disposed) return;
        cache.set(key, peaks);
        if (cache.size > 96) cache.delete(cache.keys().next().value!);
        setResult({ key, peaks });
      } catch (e) {
        if (disposed) return;
        if (String(e).includes("busy"))
          timer = setTimeout(() => {
            void request();
          }, 400);
        else setResult({ key, error: String(e) });
      }
    };
    timer = setTimeout(() => {
      void request();
    }, 150);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [key, item, start, duration, stream]);
  const peaks = result?.key === key ? result.peaks : undefined;
  const scale = Math.pow(10, gain / 20);
  const height = (value: number) =>
    25 - Math.max(-1, Math.min(1, value * scale)) * 23;
  return (
    <svg
      className="editor-waveform"
      viewBox="0 0 512 50"
      preserveAspectRatio="none"
      role="img"
      aria-label={
        result?.key === key && result.error
          ? `Waveform unavailable: ${result.error}`
          : "Audio waveform"
      }
    >
      <line
        x1="0"
        x2="512"
        y1="25"
        y2="25"
        stroke="currentColor"
        opacity=".25"
      />
      {peaks && (
        <path
          d={peaks
            .map(
              ([low, high], i) =>
                `M${((reverse ? peaks.length - 1 - i : i) * 512) / peaks.length},${height(high)}v${height(low) - height(high)}`,
            )
            .join(" ")}
          stroke="currentColor"
          strokeWidth="1"
        />
      )}
    </svg>
  );
}
