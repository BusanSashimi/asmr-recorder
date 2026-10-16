import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEditor } from "@/contexts/editor-state";
import { integer } from "@/lib/editor-time";
import { Button } from "@/components/ui/button";
import { CommandsPanel } from "./commands";
interface Multicam {
  clip: string | null;
  source: string;
  sourceTime: string;
  angle: string;
  audioFollowsVideo: boolean;
  cameras: { angle: string; name: string; enabled: boolean }[];
  recorder: { recording: boolean };
}
export function MulticamPanel({ time }: { time: string }) {
  const { snapshot, execute, query } = useEditor();
  const [data, setData] = useState<Multicam | null>(null),
    [page, setPage] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void query("multicam.inspect", { time: integer(time) })
      .then((v) => {
        if (live) setData(v as Multicam);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [query, time, snapshot?.revision]);
  const run = (id: string, p = {}) => {
    void execute(id, p).catch((e) => setError(String(e)));
  };
  return (
    <div className="editor-panel-body">
      <h3 className="editor-section-title">Multicam</h3>
      {data?.clip ? (
        <>
          <div className="grid grid-cols-2 gap-1">
            {data.cameras
              .filter((c) => c.enabled)
              .slice(page * 16, page * 16 + 16)
              .map((c) => (
                <button
                  key={c.angle}
                  className={`rounded-md overflow-hidden text-caption border-2 ${c.angle === data.angle ? "border-accent" : "border-transparent"}`}
                  onClick={(e) =>
                    run(
                      data.recorder.recording
                        ? "multicam.cut"
                        : "multicam.cutToCamera",
                      {
                        angle: Number(c.angle),
                        time: integer(time),
                        videoOnly: e.metaKey,
                      },
                    )
                  }
                >
                  <Angle
                    item={data.source}
                    angle={Number(c.angle)}
                    time={data.sourceTime}
                  />
                  <span className="block p-1 truncate">
                    {Number(c.angle) + 1} · {c.name}
                  </span>
                </button>
              ))}
          </div>
          <div className="flex gap-1 my-2">
            <Button
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              disabled={(page + 1) * 16 >= data.cameras.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
            <Button
              size="sm"
              variant={data.recorder.recording ? "destructive" : "default"}
              onClick={() => {
                run(
                  data.recorder.recording
                    ? "multicam.recordStop"
                    : "multicam.recordStart",
                  { time: integer(time) },
                );
              }}
            >
              {" "}
              {data.recorder.recording ? "Stop Cuts" : "Record Cuts"}
            </Button>
          </div>
          <label className="text-caption flex gap-2">
            <input
              type="checkbox"
              checked={data.audioFollowsVideo}
              onChange={(e) =>
                run("multicam.audioFollowsVideo", { enabled: e.target.checked })
              }
            />
            Audio Follows Video
          </label>
        </>
      ) : (
        <p className="editor-hint">
          Select source clips in Media, create a multicam source sequence, and
          add it to your timeline. Camera cuts follow the playhead.
        </p>
      )}
      <Button
        className="my-2"
        disabled={(snapshot?.state.project_selection.length ?? 0) < 2}
        onClick={() =>
          run("clip.createMulticam", {
            items: snapshot?.state.project_selection.map(integer),
            method: "audio",
            name: "Multicam",
            audio: "switch",
          })
        }
      >
        Create from Selected Sources
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-caption">
          {error}
        </p>
      )}
      <CommandsPanel category="multicam" />
      <details>
        <summary className="editor-section-title">Synchronize & Merge</summary>
        <CommandsPanel category="clip" />
      </details>
    </div>
  );
}
function Angle({
  item,
  angle,
  time,
}: {
  item: string;
  angle: number;
  time: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    latest = useRef(time),
    busy = useRef(false);
  latest.current = time;
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const frame = async () => {
      if (!busy.current) {
        busy.current = true;
        try {
          const raw = await invoke<ArrayBuffer>("editor_frame", {
            time: latest.current,
            width: 160,
            item,
            angle,
            source: true,
          });
          if (live && canvas.current) {
            const b =
              raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).buffer;
            const h = new DataView(b),
              w = h.getUint32(0, true),
              height = h.getUint32(4, true);
            canvas.current.width = w;
            canvas.current.height = height;
            canvas.current
              .getContext("2d")
              ?.putImageData(
                new ImageData(new Uint8ClampedArray(b, 8), w, height),
                0,
                0,
              );
          }
        } catch {
          /* skip a busy preview; retry on the next cycle */
        } finally {
          busy.current = false;
        }
      }
      if (live)
        timer = setTimeout(
          () => {
            void frame();
          },
          250 + angle * 7,
        );
    };
    void frame();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [item, angle]);
  return (
    <canvas
      ref={canvas}
      className="w-full aspect-video bg-stage"
      aria-label={`Camera ${angle + 1} preview`}
    />
  );
}
