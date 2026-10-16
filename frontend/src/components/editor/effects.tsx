import { KeyframeGraph } from "./keyframe-graph";
import { useEffect, useState } from "react";
import { Diamond, Trash2, Search } from "lucide-react";
import { useEditor } from "@/contexts/editor-state";
import { integer } from "@/lib/editor-time";
import { Button } from "@/components/ui/button";
import type { ParameterDefinition, ParameterValue } from "@/types/editor";

export function EffectsBrowser() {
  const { effects, snapshot, execute } = useEditor();
  const [search, setSearch] = useState("");
  const selection = snapshot?.state.selection ?? [];
  const filtered = effects.filter(
    (e) =>
      !e.intrinsic &&
      `${e.name} ${e.category.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <div className="editor-panel-body">
      <label className="editor-search">
        <Search className="h-3.5 w-3.5" />
        <input
          aria-label="Search effects and transitions"
          placeholder="Effects & transitions"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {!selection.length && (
        <p className="editor-hint">
          Select a timeline clip to apply an effect.
        </p>
      )}
      {Array.from(new Set(filtered.map((e) => e.category.join(" / ")))).map(
        (category) => (
          <details key={category} open={!!search}>
            <summary className="editor-section-title">{category}</summary>
            {filtered
              .filter((e) => e.category.join(" / ") === category)
              .map((effect) => (
                <button
                  key={effect.id}
                  className="editor-list-row"
                  disabled={!selection.length}
                  onClick={() => {
                    const command = "effects.apply";
                    void execute(command, {
                      clips: selection.map(integer),
                      effect: effect.id,
                    }).catch(() => {});
                  }}
                >
                  {effect.name}
                </button>
              ))}
          </details>
        ),
      )}
    </div>
  );
}

export function EffectInspector({
  time,
  colorOnly = false,
}: {
  time: string;
  colorOnly?: boolean;
}) {
  const { effects, snapshot, execute, query } = useEditor();
  const clips = [
    ...(snapshot?.sequence?.video_tracks ?? []),
    ...(snapshot?.sequence?.audio_tracks ?? []),
  ].flatMap((t) => t.items);
  const [inspected, setInspected] = useState<string | null>(null);
  const selected = snapshot?.state.selection ?? [];
  const clip = clips.find(
    (c) =>
      c.id ===
      (inspected && selected.includes(inspected) ? inspected : selected[0]),
  );
  const [evaluated, setEvaluated] = useState<{
    key: string;
    values: Record<string, ParameterValue>[];
  } | null>(null);
  const valueKey = `${clip?.id}:${time}:${snapshot?.revision}`;
  const clipId = clip?.id;
  useEffect(() => {
    if (!clipId) return;
    let live = true;
    const timer = setTimeout(() => {
      void query("effects.values", {
        clip: integer(clipId),
        time: integer(time),
      })
        .then((v) => {
          if (live)
            setEvaluated({
              key: valueKey,
              values: v as Record<string, ParameterValue>[],
            });
        })
        .catch(() => {});
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [clipId, time, valueKey, query]);
  if (!clip)
    return (
      <div className="editor-empty">
        Select a clip to inspect its properties.
      </div>
    );
  const apply = (id: string) => {
    void execute("effects.apply", {
      clips: [integer(clip.id)],
      effect: id,
    }).catch(() => {});
  };
  const grade = effects.find((e) => /lumetri/i.test(e.id));
  return (
    <div className="editor-panel-body">
      {selected.length > 1 ? (
        <select
          className="editor-input w-full mb-3"
          aria-label="Inspect selected clip"
          value={clip.id}
          onChange={(e) => setInspected(e.target.value)}
        >
          {selected.map((id) => {
            const c = clips.find((c) => c.id === id);
            return (
              c && (
                <option key={id} value={id}>
                  {c.name} ·{" "}
                  {snapshot?.sequence?.audio_tracks.some((t) =>
                    t.items.some((c) => c.id === id),
                  )
                    ? "Audio"
                    : "Video"}
                </option>
              )
            );
          })}
        </select>
      ) : (
        <h3 className="font-semibold truncate mb-3">{clip.name}</h3>
      )}
      {!colorOnly && (
        <details className="editor-effect" open>
          <summary className="editor-section-title">Clip</summary>
          <label className="text-caption">
            Name
            <input
              className="editor-input w-full"
              key={clip.name}
              defaultValue={clip.name}
              onBlur={(e) => {
                if (e.target.value !== clip.name)
                  void execute("clip.rename", {
                    clip: integer(clip.id),
                    name: e.target.value,
                  }).catch(() => {});
              }}
            />
          </label>
          <label className="text-caption">
            Speed (%)
            <NumberField
              id="Clip speed"
              value={clip.speed * 100}
              min={1}
              max={10000}
              onCommit={(speed) => {
                void execute("clip.speedDuration", {
                  clips: [integer(clip.id)],
                  speed,
                  reverse: clip.reverse,
                }).catch(() => {});
              }}
            />
          </label>
          <label className="text-caption flex gap-2 my-2">
            <input
              type="checkbox"
              checked={clip.reverse}
              onChange={(e) => {
                void execute("clip.speedDuration", {
                  clips: [integer(clip.id)],
                  speed: clip.speed * 100,
                  reverse: e.target.checked,
                }).catch(() => {});
              }}
            />
            Reverse
          </label>
          <label className="text-caption">
            Audio Gain (dB)
            <NumberField
              id="Clip audio gain"
              value={clip.gain_db}
              min={-96}
              max={24}
              onCommit={(db) => {
                void execute("clip.audioGain", {
                  clips: [integer(clip.id)],
                  mode: "set",
                  db,
                }).catch(() => {});
              }}
            />
          </label>
        </details>
      )}
      {colorOnly &&
        grade &&
        !clip.effects.some((e) => e.effect === grade.id) && (
          <Button onClick={() => apply(grade.id)}>Add Color Correction</Button>
        )}
      {clip.effects.map((effect, index) => {
        const def = effects.find((d) => d.id === effect.effect);
        if (!def || (colorOnly && !/color|lumetri/i.test(def.id))) return null;
        return (
          <details key={`${clip.id}-${index}`} open className="editor-effect">
            <summary className="editor-section-title">{def.name}</summary>
            <div className="flex justify-between items-center pb-2">
              <label className="text-caption flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={effect.enabled}
                  onChange={() => {
                    void execute("effects.toggleEnabled", {
                      clip: integer(clip.id),
                      index,
                    }).catch(() => {});
                  }}
                />
                Enabled
              </label>
              {!def.intrinsic && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${def.name}`}
                  onClick={() => {
                    void execute("effects.remove", {
                      clip: integer(clip.id),
                      index,
                    }).catch(() => {});
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            {Array.from(
              new Set(def.params.map((p) => p.group ?? "Parameters")),
            ).map((group) => (
              <details
                key={group}
                open={def.params.length < 20 || group === "Basic Correction"}
              >
                <summary className="editor-section-title">{group}</summary>
                {def.params
                  .filter((p) => (p.group ?? "Parameters") === group)
                  .map((p) => {
                    const param = effect.params[p.id];
                    return (
                      <div key={p.id} className="editor-param">
                        <div className="flex items-center gap-1">
                          <label
                            className="text-caption flex-1"
                            htmlFor={`${clip.id}-${index}-${p.id}`}
                          >
                            {p.label}
                          </label>
                          {p.animatable && (
                            <button
                              className="editor-keyframe"
                              title="Add or remove keyframe at playhead"
                              aria-label={`Keyframe ${p.label}`}
                              onClick={() => {
                                void execute("effects.addKeyframe", {
                                  clip: integer(clip.id),
                                  effect: index,
                                  param: p.id,
                                  time: integer(time),
                                }).catch(() => {});
                              }}
                            >
                              <Diamond
                                className={
                                  param?.keyframes?.length
                                    ? "fill-accent text-accent"
                                    : ""
                                }
                              />
                            </button>
                          )}
                        </div>
                        <ParameterControl
                          id={`${clip.id}-${index}-${p.id}`}
                          definition={p}
                          value={
                            evaluated?.key === valueKey
                              ? (evaluated.values[index]?.[p.id] ??
                                param?.value ??
                                p.default)
                              : (param?.value ?? p.default)
                          }
                          onCommit={(value) => {
                            void execute("effects.setParam", {
                              clip: integer(clip.id),
                              effect: index,
                              param: p.id,
                              value,
                              time: integer(time),
                              keyframe: !!param?.keyframes?.length,
                            }).catch(() => {});
                          }}
                        />
                        {!!param?.keyframes?.length && (
                          <KeyframeGraph
                            clip={clip}
                            effect={index}
                            param={p}
                            keys={param.keyframes}
                          />
                        )}
                        {!!param?.keyframes?.length && (
                          <div className="editor-keyframes">
                            {param.keyframes.map((k, i) => (
                              <span key={k.time} title={`Media time ${k.time}`}>
                                ◆ {i + 1}
                                <select
                                  aria-label={`${p.label} keyframe ${i + 1} interpolation`}
                                  className="editor-input"
                                  value={
                                    typeof k.interp === "string"
                                      ? k.interp
                                      : "Linear"
                                  }
                                  onChange={(e) => {
                                    void execute("effects.setInterpolation", {
                                      clip: integer(clip.id),
                                      effect: index,
                                      param: p.id,
                                      mediaTime: integer(k.time),
                                      interpolation:
                                        e.target.value[0].toLowerCase() +
                                        e.target.value.slice(1),
                                    }).catch(() => {});
                                  }}
                                >
                                  {[
                                    "Linear",
                                    "Hold",
                                    "Bezier",
                                    "AutoBezier",
                                    "ContinuousBezier",
                                    "EaseIn",
                                    "EaseOut",
                                  ].map((x) => (
                                    <option key={x}>{x}</option>
                                  ))}
                                </select>
                                <label className="text-caption">
                                  In
                                  <input
                                    aria-label={`${p.label} keyframe ${i + 1} incoming influence`}
                                    className="editor-input w-16"
                                    type="number"
                                    min="0"
                                    max="1"
                                    step=".05"
                                    key={`in-${k.in_influence}`}
                                    defaultValue={k.in_influence}
                                    onBlur={(e) => {
                                      void execute("effects.setKeyframe", {
                                        clip: integer(clip.id),
                                        effect: index,
                                        param: p.id,
                                        mediaTime: integer(k.time),
                                        inInfluence: Number(e.target.value),
                                      }).catch(() => {});
                                    }}
                                  />
                                </label>
                                <label className="text-caption">
                                  Out
                                  <input
                                    aria-label={`${p.label} keyframe ${i + 1} outgoing influence`}
                                    className="editor-input w-16"
                                    type="number"
                                    min="0"
                                    max="1"
                                    step=".05"
                                    key={`out-${k.out_influence}`}
                                    defaultValue={k.out_influence}
                                    onBlur={(e) => {
                                      void execute("effects.setKeyframe", {
                                        clip: integer(clip.id),
                                        effect: index,
                                        param: p.id,
                                        mediaTime: integer(k.time),
                                        outInfluence: Number(e.target.value),
                                      }).catch(() => {});
                                    }}
                                  />
                                </label>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </details>
            ))}
          </details>
        );
      })}
    </div>
  );
}

export function ParameterControl({
  id,
  definition: p,
  value,
  onCommit,
}: {
  id: string;
  definition: ParameterDefinition;
  value: ParameterValue;
  onCommit: (value: unknown) => void;
}) {
  const kind = p.kind;
  if (kind === "Bool")
    return (
      <input
        id={id}
        type="checkbox"
        checked={value.Bool ?? false}
        onChange={(e) => onCommit(e.target.checked)}
      />
    );
  if (kind === "Text")
    return (
      <textarea
        key={String(value.Text)}
        id={id}
        className="editor-input w-full"
        defaultValue={value.Text ?? ""}
        onBlur={(e) => {
          if (e.target.value !== value.Text) onCommit(e.target.value);
        }}
      />
    );
  if (typeof kind === "object" && kind.Choice)
    return (
      <select
        id={id}
        className="editor-input w-full"
        value={value.Choice ?? "0"}
        onChange={(e) => onCommit(Number(e.target.value))}
      >
        {kind.Choice.map((v, i) => (
          <option key={v} value={i}>
            {v}
          </option>
        ))}
      </select>
    );
  if (kind === "Color") {
    const rgba = value.Color ?? [0, 0, 0, 1];
    const hex =
      "#" +
      rgba
        .slice(0, 3)
        .map((v) =>
          Math.round(Math.max(0, Math.min(1, v)) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("");
    return (
      <input
        id={id}
        type="color"
        value={hex}
        className="w-full h-7 bg-fill rounded-md"
        onChange={(e) =>
          onCommit(
            [1, 3, 5]
              .map((i) => parseInt(e.target.value.slice(i, i + 2), 16) / 255)
              .concat(rgba[3] ?? 1),
          )
        }
      />
    );
  }
  if (kind === "Point" || kind === "Wheel")
    return (
      <div className="flex gap-2">
        {(["x", "y"] as const).map((axis) => (
          <label key={axis} className="flex gap-1 items-center text-caption">
            {axis.toUpperCase()}
            <NumberField
              id={`${id}-${axis}`}
              value={value.Vec2?.[axis] ?? 0}
              onCommit={(n) =>
                onCommit([
                  axis === "x" ? n : (value.Vec2?.x ?? 0),
                  axis === "y" ? n : (value.Vec2?.y ?? 0),
                ])
              }
            />
          </label>
        ))}
      </div>
    );
  if (typeof kind === "object" && kind.Curve)
    return (
      <CurveControl
        points={
          value.Curve ?? [
            [0, 0],
            [1, 1],
          ]
        }
        onCommit={onCommit}
      />
    );
  if (kind === "Path")
    return (
      <PathControl
        path={value.Path ?? { closed: true, vertices: [] }}
        onCommit={onCommit}
      />
    );
  const bounds = typeof kind === "object" ? kind.Float : undefined;
  return (
    <div className="flex gap-2 items-center">
      <NumberField
        id={id}
        value={value.Float ?? 0}
        min={bounds?.min}
        max={bounds?.max}
        onCommit={onCommit}
      />
      <span className="text-caption text-muted-foreground">{bounds?.unit}</span>
    </div>
  );
}

export function NumberField({
  id,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  return (
    <input
      key={`${id}:${value}`}
      id={id}
      aria-label={id}
      type="number"
      step="any"
      min={min}
      max={max}
      className="editor-input w-full min-w-0 tabular-nums"
      defaultValue={Number.isFinite(value) ? value : 0}
      onBlur={(e) => {
        const n = e.target.valueAsNumber;
        if (
          Number.isFinite(n) &&
          n !== value &&
          (min === undefined || n >= min) &&
          (max === undefined || n <= max)
        )
          onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function CurveControl({
  points,
  onCommit,
}: {
  points: number[][];
  onCommit: (v: unknown) => void;
}) {
  const [draft, setDraft] = useState<number[][] | null>(null);
  const pts = draft ?? points;
  return (
    <div>
      <svg
        viewBox="0 0 200 100"
        className="editor-curve"
        aria-label="Tone curve"
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onCommit(
            [
              ...points,
              [
                (e.clientX - r.left) / r.width,
                1 - (e.clientY - r.top) / r.height,
              ],
            ].sort((a, b) => a[0] - b[0]),
          );
        }}
      >
        <path
          d="M0 25H200M0 50H200M0 75H200M50 0V100M100 0V100M150 0V100"
          stroke="currentColor"
          opacity=".15"
        />
        <polyline
          fill="none"
          stroke="currentColor"
          points={pts.map((p) => `${p[0] * 200},${100 - p[1] * 100}`).join(" ")}
        />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p[0] * 200}
            cy={100 - p[1] * 100}
            r="4"
            fill="currentColor"
            tabIndex={0}
            role="slider"
            aria-label={`Curve point ${i + 1}`}
            aria-valuenow={p[1]}
            aria-valuemin={0}
            aria-valuemax={1}
            onKeyDown={(e) => {
              if (e.key === "Delete" && points.length > 2)
                onCommit(points.filter((_, j) => i !== j));
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                onCommit(
                  points.map((v, j) =>
                    i === j
                      ? [
                          v[0],
                          Math.max(
                            0,
                            Math.min(
                              1,
                              v[1] + (e.key === "ArrowUp" ? 0.01 : -0.01),
                            ),
                          ),
                        ]
                      : v,
                  ),
                );
              }
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDraft(points.map((v) => [...v]));
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const r =
                e.currentTarget.ownerSVGElement!.getBoundingClientRect();
              setDraft(
                pts.map((v, j) =>
                  j === i
                    ? [
                        Math.max(
                          i === 0 ? 0 : pts[i - 1][0] + 0.001,
                          Math.min(
                            i === pts.length - 1 ? 1 : pts[i + 1][0] - 0.001,
                            (e.clientX - r.left) / r.width,
                          ),
                        ),
                        Math.max(
                          0,
                          Math.min(1, 1 - (e.clientY - r.top) / r.height),
                        ),
                      ]
                    : v,
                ),
              );
            }}
            onPointerUp={() => {
              if (draft) onCommit(draft);
              setDraft(null);
            }}
            onPointerCancel={() => setDraft(null)}
          />
        ))}
      </svg>
      <p className="editor-hint">
        Double-click to add a point. Drag to adjust.
      </p>
    </div>
  );
}

function PathControl({
  path,
  onCommit,
}: {
  path: NonNullable<ParameterValue["Path"]>;
  onCommit: (v: unknown) => void;
}) {
  const update = (
    i: number,
    point: "p" | "t_in" | "t_out",
    axis: "x" | "y",
    value: number,
  ) =>
    onCommit({
      ...path,
      vertices: path.vertices.map((v, j) =>
        i === j
          ? {
              ...v,
              [point]: {
                x: v[point]?.x ?? 0,
                y: v[point]?.y ?? 0,
                [axis]: value,
              },
            }
          : v,
      ),
    });
  return (
    <div>
      <label className="text-caption flex gap-2">
        <input
          type="checkbox"
          checked={path.closed}
          onChange={(e) => onCommit({ ...path, closed: e.target.checked })}
        />
        Closed Path
      </label>
      {path.vertices.map((v, i) => (
        <details key={i}>
          <summary className="editor-section-title">Vertex {i + 1}</summary>
          {(["p", "t_in", "t_out"] as const).map((point) => (
            <div key={point} className="flex gap-1 my-1 items-center">
              <span className="text-caption w-12">
                {point === "p" ? "Point" : point === "t_in" ? "In" : "Out"}
              </span>
              {(["x", "y"] as const).map((axis) => (
                <NumberField
                  key={axis}
                  id={`Vertex ${i + 1} ${point} ${axis}`}
                  value={v[point]?.[axis] ?? 0}
                  onCommit={(value) => update(i, point, axis, value)}
                />
              ))}
            </div>
          ))}
          <Button
            size="sm"
            onClick={() =>
              onCommit({
                ...path,
                vertices: path.vertices.filter((_, j) => j !== i),
              })
            }
          >
            Remove Vertex
          </Button>
        </details>
      ))}
      <Button
        size="sm"
        className="mt-1"
        onClick={() =>
          onCommit({
            ...path,
            vertices: [...path.vertices, { p: { x: 0, y: 0 } }],
          })
        }
      >
        Add Vertex
      </Button>
    </div>
  );
}
