import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/contexts/editor-state";
import { integer, seconds, tickAtSeconds, frameTick } from "@/lib/editor-time";
import type { Clip, Keyframe, ParameterDefinition } from "@/types/editor";
export function KeyframeGraph({
  clip,
  effect,
  param,
  keys,
}: {
  clip: Clip;
  effect: number;
  param: ParameterDefinition;
  keys: Keyframe[];
}) {
  const { execute, snapshot, query } = useEditor();
  const [draft, setDraft] = useState<{
    i: number;
    time: string;
    value: number;
  } | null>(null);
  const [curve, setCurve] = useState<{
    key: string;
    points: number[][];
  } | null>(null);
  const curveKey = `${clip.id}:${effect}:${param.id}:${snapshot?.revision}`;
  useEffect(() => {
    let live = true;
    void query("effects.curve", {
      clip: integer(clip.id),
      effect,
      param: param.id,
    })
      .then((v) => {
        if (live) setCurve({ key: curveKey, points: v as number[][] });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [clip.id, effect, param.id, query, curveKey]);
  const drag = useRef<typeof draft>(null);
  if (!keys.every((k) => k.value.Float !== undefined)) return null;
  const start = seconds(clip.source_in),
    end = start + seconds(clip.duration) * Math.abs(clip.speed);
  const values = keys.map((k) => k.value.Float ?? 0);
  const bounds = typeof param.kind === "object" ? param.kind.Float : undefined;
  const low = Math.min(...values, bounds?.soft_min ?? 0),
    high = Math.max(low + 1, ...values, bounds?.soft_max ?? 100);
  const x = (t: string) =>
    10 + ((seconds(t) - start) / Math.max(0.001, end - start)) * 280;
  const y = (v: number) => 90 - ((v - low) / (high - low)) * 80;
  const base = { clip: integer(clip.id), effect, param: param.id };
  const run = (id: string, p: Record<string, unknown>) => {
    void execute(id, { ...base, ...p }).catch(() => {});
  };
  return (
    <div className="mt-2">
      <svg
        viewBox="0 0 300 100"
        className="editor-curve"
        role="group"
        aria-label={`${param.label} keyframe values`}
      >
        <path
          d="M10 10H290M10 50H290M10 90H290"
          stroke="currentColor"
          opacity=".15"
        />
        {curve?.key === curveKey && !draft && (
          <polyline
            stroke="currentColor"
            fill="none"
            points={curve.points
              .map(
                ([t, v]) =>
                  `${10 + ((t - start) / Math.max(0.001, end - start)) * 280},${y(v)}`,
              )
              .join(" ")}
          />
        )}
        <polyline
          opacity={draft ? 1 : 0.25}
          stroke="currentColor"
          fill="none"
          strokeWidth="1"
          strokeDasharray="3 2"
          points={keys
            .map(
              (k, i) =>
                `${x(draft?.i === i ? draft.time : k.time)},${y(draft?.i === i ? draft.value : (k.value.Float ?? 0))}`,
            )
            .join(" ")}
        />
        {keys.map((k, i) => (
          <circle
            key={k.time}
            cx={x(draft?.i === i ? draft.time : k.time)}
            cy={y(draft?.i === i ? draft.value : (k.value.Float ?? 0))}
            r="4"
            fill="currentColor"
            role="slider"
            tabIndex={0}
            aria-label={`${param.label} keyframe ${i + 1}`}
            aria-valuenow={k.value.Float}
            aria-valuemin={low}
            aria-valuemax={high}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { i, time: k.time, value: k.value.Float ?? 0 };
              setDraft(drag.current);
            }}
            onPointerMove={(e) => {
              if (drag.current?.i !== i) return;
              const r =
                e.currentTarget.ownerSVGElement!.getBoundingClientRect();
              const t =
                start +
                Math.max(
                  0,
                  Math.min(
                    1,
                    (((e.clientX - r.left) / r.width) * 300 - 10) / 280,
                  ),
                ) *
                  (end - start);
              const v =
                low +
                Math.max(
                  0,
                  Math.min(
                    1,
                    (90 - ((e.clientY - r.top) / r.height) * 100) / 80,
                  ),
                ) *
                  (high - low);
              drag.current = { i, time: String(tickAtSeconds(t)), value: v };
              setDraft(drag.current);
            }}
            onPointerUp={() => {
              if (drag.current)
                run("effects.moveKeyframe", {
                  mediaTime: integer(k.time),
                  to: integer(drag.current.time),
                  value: drag.current.value,
                });
              drag.current = null;
              setDraft(null);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                e.stopPropagation();
                run("effects.deleteKeyframe", { mediaTime: integer(k.time) });
              }
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                run("effects.moveKeyframe", {
                  mediaTime: integer(k.time),
                  to: integer(
                    BigInt(k.time) +
                      frameTick(
                        e.key === "ArrowLeft" ? -1n : 1n,
                        snapshot?.sequence?.settings.frame_rate ?? {
                          num: "30",
                          den: "1",
                        },
                      ),
                  ),
                });
              }
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                run("effects.setKeyframe", {
                  mediaTime: integer(k.time),
                  value: (k.value.Float ?? 0) + (e.key === "ArrowUp" ? 1 : -1),
                });
              }
            }}
          />
        ))}
      </svg>
      <p className="editor-hint">
        Drag points to change time and value. The solid line shows the evaluated
        interpolation.
      </p>
    </div>
  );
}
