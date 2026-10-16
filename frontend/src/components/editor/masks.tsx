import { useEffect, useRef, useState } from "react";
import { FramePreview } from "./frame-preview";
import { useEditor } from "@/contexts/editor-state";
import { integer, seconds, tickAtSeconds } from "@/lib/editor-time";
import { Button } from "@/components/ui/button";
import { NumberField } from "./effects";
import { CommandsPanel } from "./commands";
interface Mask {
  clip: string;
  effect: string;
  mask: string;
  name: string;
  inverted: boolean;
  mode: string;
  feather: number;
  opacity: number;
  expansion: number;
  path: {
    vertices: { p: number[]; in: number[]; out: number[] }[];
    closed: boolean;
  };
}
export function MasksPanel({ time }: { time: string }) {
  const { snapshot, execute, query } = useEditor();
  const [masks, setMasks] = useState<Mask[]>([]),
    [selected, setSelected] = useState(0),
    [points, setPoints] = useState<number[][]>([]),
    [drawing, setDrawing] = useState(false),
    [error, setError] = useState("");
  const drag = useRef<{ i: number; p: number[] } | null>(null);
  const [draft, setDraft] = useState<{ i: number; p: number[] } | null>(null);
  const clip = snapshot?.sequence?.video_tracks
    .flatMap((t) => t.items)
    .find((c) => snapshot.state.selection.includes(c.id));
  const media = clip
    ? snapshot?.project.items[clip.item]?.kind.Media
    : undefined;
  const w = Number(
      media?.info.video?.width ?? snapshot?.sequence?.settings.width ?? 1920,
    ),
    h = Number(
      media?.info.video?.height ?? snapshot?.sequence?.settings.height ?? 1080,
    );
  const clipId = clip?.id,
    itemId = clip?.item;
  const mask = clipId
    ? masks.filter((m) => m.clip === clipId)[selected]
    : undefined;
  useEffect(() => {
    let live = true;
    if (!clipId) return;
    void query("masks.list", { clip: integer(clipId), time: integer(time) })
      .then((v) => {
        if (live) setMasks((v as { masks: Mask[] }).masks);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [query, clipId, snapshot?.revision, time]);
  const elapsed = clip
    ? Math.max(
        0,
        Math.min(seconds(clip.duration), seconds(time) - seconds(clip.start)),
      )
    : 0;
  const sourceTime = clip
    ? tickAtSeconds(
        seconds(clip.source_in) +
          (clip.reverse ? seconds(clip.duration) - elapsed : elapsed) *
            Math.abs(clip.speed),
      ).toString()
    : "0";
  const base = {
    clip: clip ? integer(clip.id) : undefined,
    effect: mask ? Number(mask.effect) : "opacity",
    mask: mask ? Number(mask.mask) : 0,
  };
  const run = (id: string, p = {}) => {
    void execute(id, { ...base, ...p })
      .then(() => setError(""))
      .catch((e) => setError(String(e)));
  };
  const at = (e: React.PointerEvent<SVGElement>) => {
    const svg =
      e.currentTarget instanceof SVGSVGElement
        ? e.currentTarget
        : e.currentTarget.ownerSVGElement!;
    const r = svg.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * w,
      ((e.clientY - r.top) / r.height) * h,
    ];
  };
  const vertices = mask?.path.vertices ?? [];
  let d = "";
  vertices.forEach((v, i) => {
    const p = draft?.i === i ? draft.p : v.p;
    if (i === 0) d = `M${p[0]} ${p[1]}`;
    else {
      const a = vertices[i - 1];
      d += ` C${a.p[0] + a.out[0]} ${a.p[1] + a.out[1]} ${p[0] + v.in[0]} ${p[1] + v.in[1]} ${p[0]} ${p[1]}`;
    }
  });
  if (vertices.length && mask?.path.closed) {
    const a = vertices.at(-1)!,
      b = vertices[0];
    d += ` C${a.p[0] + a.out[0]} ${a.p[1] + a.out[1]} ${b.p[0] + b.in[0]} ${b.p[1] + b.in[1]} ${b.p[0]} ${b.p[1]} Z`;
  }
  return (
    <div className="editor-panel-body">
      <h3 className="editor-section-title">Masks</h3>
      {!clip ? (
        <p className="editor-hint">Select a video clip to edit its masks.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 mb-2">
            <Button
              size="sm"
              onClick={() =>
                run("masks.add", {
                  effect: "opacity",
                  shape: "ellipse",
                  center: [w / 2, h / 2],
                  size: [w / 2, h / 2],
                })
              }
            >
              Ellipse
            </Button>
            <Button
              size="sm"
              onClick={() =>
                run("masks.add", {
                  effect: "opacity",
                  shape: "rectangle",
                  center: [w / 2, h / 2],
                  size: [w / 2, h / 2],
                })
              }
            >
              Rectangle
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setPoints([]);
                setDrawing((v) => !v);
              }}
            >
              Draw Polygon
            </Button>
          </div>
          <div
            className="relative bg-stage rounded-md overflow-hidden"
            style={{ aspectRatio: `${w}/${h}` }}
          >
            {itemId && snapshot && (
              <FramePreview
                item={itemId}
                time={sourceTime}
                revision={snapshot.revision}
                width={480}
                label="Mask source frame"
              />
            )}
            <svg
              viewBox={`0 0 ${w} ${h}`}
              className="absolute inset-0 w-full h-full touch-none"
              role="group"
              aria-label="Mask path in source coordinates"
              onPointerDown={(e) => {
                if (drawing) setPoints((p) => [...p, at(e)]);
              }}
            >
              <path
                d={d}
                stroke="white"
                strokeWidth={w / 200}
                fill="hsl(var(--accent)/.15)"
              />
              {drawing && (
                <polyline
                  points={points.map((p) => p.join(",")).join(" ")}
                  stroke="hsl(var(--accent))"
                  strokeWidth={w / 180}
                  fill="none"
                />
              )}
              {!drawing &&
                vertices.map((v, i) => (
                  <circle
                    key={i}
                    cx={draft?.i === i ? draft.p[0] : v.p[0]}
                    cy={draft?.i === i ? draft.p[1] : v.p[1]}
                    r={w / 70}
                    fill="hsl(var(--accent))"
                    stroke="white"
                    strokeWidth={w / 400}
                    tabIndex={0}
                    role="button"
                    aria-label={`Mask vertex ${i + 1}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      drag.current = { i, p: v.p };
                    }}
                    onPointerMove={(e) => {
                      if (drag.current?.i === i) {
                        drag.current = { i, p: at(e) };
                        setDraft(drag.current);
                      }
                    }}
                    onPointerUp={() => {
                      if (drag.current)
                        run("masks.moveVertex", {
                          vertex: i,
                          to: drag.current.p,
                          time: integer(time),
                        });
                      drag.current = null;
                      setDraft(null);
                    }}
                    onPointerCancel={() => {
                      drag.current = null;
                      setDraft(null);
                    }}
                    onDoubleClick={() =>
                      run("masks.toggleVertexSmooth", { vertex: i })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Delete") {
                        e.preventDefault();
                        e.stopPropagation();
                        run("masks.removeVertex", { vertex: i });
                      }
                      const delta: Record<string, number[]> = {
                        ArrowLeft: [-1, 0],
                        ArrowRight: [1, 0],
                        ArrowUp: [0, -1],
                        ArrowDown: [0, 1],
                      };
                      if (delta[e.key]) {
                        e.preventDefault();
                        run("masks.moveVertex", {
                          vertex: i,
                          delta: delta[e.key],
                        });
                      }
                    }}
                  />
                ))}
            </svg>
          </div>
          {mask && (
            <details>
              <summary className="editor-section-title">Bézier Handles</summary>
              {vertices.map((v, i) => (
                <details key={i}>
                  <summary className="editor-section-title">
                    Vertex {i + 1}
                  </summary>
                  {(["in", "out"] as const).map((handle) => (
                    <div key={handle} className="flex gap-1 items-center">
                      <span className="text-caption">{handle}</span>
                      {[0, 1].map((axis) => (
                        <NumberField
                          key={axis}
                          id={`Vertex ${i + 1} ${handle} ${axis ? "Y" : "X"}`}
                          value={v[handle][axis]}
                          onCommit={(value) =>
                            run("masks.moveVertex", {
                              vertex: i,
                              handle,
                              delta: axis
                                ? [0, value - v[handle][1]]
                                : [value - v[handle][0], 0],
                              breakHandles: true,
                            })
                          }
                        />
                      ))}
                    </div>
                  ))}
                </details>
              ))}
            </details>
          )}
          {drawing && (
            <div className="flex gap-2 my-2">
              <Button
                disabled={points.length < 3}
                onClick={() => {
                  run("masks.add", {
                    effect: "opacity",
                    shape: "polygon",
                    path: points,
                  });
                  setDrawing(false);
                }}
              >
                Finish Polygon
              </Button>
              <Button onClick={() => setDrawing(false)}>Cancel</Button>
            </div>
          )}
          <p className="editor-hint mt-2">
            Source coordinates before motion and effects. Drag vertices;
            double-click for smooth handles. Arrow keys nudge, Delete removes a
            vertex.
          </p>
          <select
            className="editor-input w-full mt-2"
            aria-label="Selected mask"
            value={Math.min(selected, Math.max(0, masks.length - 1))}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {masks.map((m, i) => (
              <option key={`${m.effect}-${m.mask}`} value={i}>
                {m.name}
              </option>
            ))}
          </select>
          {mask && (
            <>
              <label className="text-caption flex gap-2 my-2">
                <input
                  type="checkbox"
                  checked={mask.inverted}
                  onChange={(e) =>
                    run("masks.set", { inverted: e.target.checked })
                  }
                />
                Invert Mask
              </label>
              {(["feather", "opacity", "expansion"] as const).map((p) => (
                <label key={p} className="text-caption block capitalize">
                  {p}
                  <NumberField
                    id={`Mask ${p}`}
                    value={mask[p]}
                    onCommit={(value) =>
                      run("masks.set", { [p]: value, time: integer(time) })
                    }
                  />
                </label>
              ))}
              <div className="flex gap-1 flex-wrap mt-2">
                <Button
                  size="sm"
                  onClick={() =>
                    run("masks.track", { direction: "forward", wait: false })
                  }
                >
                  Track Forward
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    run("masks.track", { direction: "backward", wait: false })
                  }
                >
                  Track Backward
                </Button>
                <Button size="sm" onClick={() => run("masks.remove")}>
                  Delete Mask
                </Button>
              </div>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="editor-hint text-destructive">
          {error}
        </p>
      )}
      <details>
        <summary className="editor-section-title">
          Advanced Mask Controls
        </summary>
        <CommandsPanel category="masks" />
      </details>
    </div>
  );
}
