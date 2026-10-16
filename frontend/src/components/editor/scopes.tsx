import { useEffect, useState } from "react";
import { useEditor } from "@/contexts/editor-state";
import { integer } from "@/lib/editor-time";
interface ScopeData {
  histogram?: Record<string, (number | string)[]>;
  waveform?: {
    traces: Record<
      string,
      ({ min: number; max: number; mean: number } | null)[]
    >;
  };
  parade?: {
    traces: Record<
      string,
      ({ min: number; max: number; mean: number } | null)[]
    >;
  };
  vectorscopeYuv?: { peaks: { cb: number; cr: number; share: number }[] };
  vectorscopeHls?: { peaks: { cb: number; cr: number; share: number }[] };
  unit: string;
  colorSpace: string;
}
const colors = ["#ff6b6b", "#50c878", "#5ea2ff", "#ddd"];
export function ScopesPanel({ time }: { time: string }) {
  const { query, snapshot } = useEditor();
  const [data, setData] = useState<ScopeData | null>(null),
    [error, setError] = useState(""),
    [kind, setKind] = useState("histogram");
  const sequenceId = snapshot?.state.active_sequence;
  useEffect(() => {
    if (!sequenceId) return;
    let live = true;
    const timer = setTimeout(() => {
      void query("scopes.read", {
        scopes: [kind],
        columns: 128,
        peaks: 64,
        scale: 0.125,
        time: integer(time),
      })
        .then((v) => {
          if (live) {
            setData(v as ScopeData);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, time, snapshot?.revision, kind, sequenceId]);
  const traces =
    kind === "histogram"
      ? null
      : (kind === "parade" ? data?.parade : data?.waveform)?.traces;
  return (
    <div className="editor-panel-body">
      <select
        aria-label="Video scope"
        className="editor-input w-full mb-3"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
      >
        <option value="histogram">RGB Histogram</option>
        <option value="waveform">RGB Waveform</option>
        <option value="parade">RGB Parade</option>
        <option value="vectorscopeYuv">YUV Vectorscope</option>
        <option value="vectorscopeHls">HLS Vectorscope</option>
      </select>
      <svg
        viewBox="0 0 512 256"
        role="img"
        aria-label={kind}
        className="w-full rounded-md bg-stage"
      >
        <path d="M0 64H512M0 128H512M0 192H512" stroke="#ffffff22" />
        {kind === "histogram" &&
          ["r", "g", "b", "y"].map((c, i) => {
            const values = data?.histogram?.[c]?.map(Number) ?? [];
            const max = Math.max(1, ...values);
            return (
              <polyline
                key={c}
                points={values
                  .map(
                    (v, x) =>
                      `${(x * 512) / Math.max(1, values.length - 1)},${256 - (v / max) * 250}`,
                  )
                  .join(" ")}
                stroke={colors[i]}
                fill="none"
                opacity=".8"
              />
            );
          })}
        {kind.startsWith("vectorscope") && (
          <g
            transform="translate(256 128)"
            stroke="currentColor"
            className="text-muted-foreground"
          >
            <circle r="120" fill="none" />
            <path d="M-120 0H120M0 -120V120" opacity=".3" />
            {(kind === "vectorscopeYuv"
              ? data?.vectorscopeYuv
              : data?.vectorscopeHls
            )?.peaks.map((p, i) => (
              <circle
                key={i}
                cx={p.cb * 2.4}
                cy={-p.cr * 2.4}
                r={2 + Math.sqrt(p.share) * 8}
                fill="currentColor"
                opacity={0.35 + Math.min(0.65, p.share * 4)}
              />
            ))}
          </g>
        )}
        {traces &&
          Object.entries(traces).map(([name, values], i) => (
            <g key={name} stroke={colors[i % 4]} opacity=".6">
              {values.map(
                (v, x) =>
                  v && (
                    <line
                      key={x}
                      x1={
                        kind === "parade"
                          ? (i * 512 + (x * 512) / values.length) /
                            Object.keys(traces).length
                          : (x * 512) / values.length
                      }
                      x2={
                        kind === "parade"
                          ? (i * 512 + (x * 512) / values.length) /
                            Object.keys(traces).length
                          : (x * 512) / values.length
                      }
                      y1={256 - v.min * 2.56}
                      y2={256 - v.max * 2.56}
                    />
                  ),
              )}
            </g>
          ))}
      </svg>
      <p className="editor-hint mt-2">
        {data?.colorSpace} · {data?.unit} · Current frame
        {kind.startsWith("vectorscope") ? " · 64 strongest chroma bins" : ""}
      </p>
      {error && (
        <p role="alert" className="text-destructive text-caption">
          {error}
        </p>
      )}
    </div>
  );
}
