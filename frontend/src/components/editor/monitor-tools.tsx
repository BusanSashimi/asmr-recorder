import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useEditor } from "@/contexts/editor-state";
import { Button } from "@/components/ui/button";
import {
  frameTick,
  integer,
  seconds,
  tickAtSeconds,
  timecode,
} from "@/lib/editor-time";
import { FramePreview } from "./frame-preview";
import { CommandsPanel } from "./commands";

export function ComparisonPanel({ time }: { time: string }) {
  const { snapshot } = useEditor();
  const [reference, setReference] = useState("0");
  return (
    <div className="editor-panel-body">
      <div className="flex gap-1 mb-3">
        <Button
          disabled={!snapshot?.sequence}
          onClick={() => setReference(time)}
        >
          Capture Reference
        </Button>
        <span className="text-caption self-center">
          {timecode(reference, snapshot?.sequence?.settings.frame_rate)}
        </span>
      </div>
      {snapshot?.sequence && (
        <div className="grid grid-cols-2 gap-2">
          <figure>
            <FramePreview
              time={reference}
              revision={snapshot.revision}
              width={320}
              label="Reference frame"
            />
            <figcaption className="editor-hint">Reference</figcaption>
          </figure>
          <figure>
            <FramePreview
              time={time}
              revision={snapshot.revision}
              width={320}
              label="Current frame"
            />
            <figcaption className="editor-hint">Current</figcaption>
          </figure>
        </div>
      )}
      <p className="editor-hint mt-2">
        Compare two positions in the active sequence. The reference updates with
        your edits.
      </p>
    </div>
  );
}

export function TrimPanel() {
  const { snapshot, execute } = useEditor();
  const [mode, setMode] = useState("regular");
  const clip = [
    ...(snapshot?.sequence?.video_tracks ?? []),
    ...(snapshot?.sequence?.audio_tracks ?? []),
  ]
    .flatMap((t) => t.items)
    .find(
      (c) =>
        snapshot?.state.selection.includes(c.id) ||
        snapshot?.state.edit_points?.some((point) => point.clip === c.id),
    );
  const rate = snapshot?.sequence?.settings.frame_rate;
  if (!clip || !snapshot || !rate)
    return (
      <div className="editor-empty">
        Select a clip to trim its first and last frames.
      </div>
    );
  const first = BigInt(clip.source_in),
    last =
      first +
      tickAtSeconds(seconds(clip.duration) * Math.abs(clip.speed)) -
      frameTick(1n, rate);
  return (
    <div className="editor-panel-body">
      <h3 className="editor-section-title">{clip.name}</h3>
      <label className="text-caption">
        Trim Mode
        <select
          className="editor-input w-full mb-3"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="regular">Regular</option>
          <option value="ripple">Ripple</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {(["in", "out"] as const).map((edge, i) => (
          <section key={edge}>
            <FramePreview
              item={clip.item}
              time={String(
                (clip.reverse ? !i : i) ? (last > first ? last : first) : first,
              )}
              revision={snapshot.revision}
              width={320}
              label={`${edge} frame`}
            />
            <p className="editor-hint my-2">
              {i ? "Last frame" : "First frame"}
            </p>
            <div className="flex flex-wrap gap-1">
              {[-5, -1, 1, 5].map((delta) => (
                <Button
                  key={delta}
                  size="sm"
                  onClick={() => {
                    void execute("timeline.trim", {
                      clip: integer(clip.id),
                      edge,
                      mode,
                      deltaFrames: delta,
                    }).catch(() => {});
                  }}
                >
                  {delta > 0 ? "+" : ""}
                  {delta}
                </Button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <DynamicTrim clip={clip.id} />
      <details>
        <summary className="editor-section-title">Trim Tools</summary>
        <CommandsPanel category="trim" />
      </details>
    </div>
  );
}

type TrimSide = { item: string; mediaTime: string; name: string };
type TrimMonitor = {
  revision: string;
  active: boolean;
  edge: string;
  kind: string;
  outgoing?: TrimSide;
  incoming?: TrimSide;
  dynamic?: { offsetFrames: string; speed: number; atLimit: boolean };
  playAround?: object;
};
function DynamicTrim({ clip }: { clip: string }) {
  const { execute } = useEditor();
  const [monitor, setMonitor] = useState<TrimMonitor | null>(null);
  const [kind, setKind] = useState("ripple");
  const [error, setError] = useState<string | null>(null);
  const run = (command: string, params: Record<string, unknown> = {}) => {
    void execute(command, params)
      .then(() => setError(null))
      .catch((e) => setError(String(e)));
  };
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await invoke<TrimMonitor>("editor_query", {
          command: "trim.monitor",
          params: {},
        });
        if (!stopped) setMonitor(value);
      } catch {
        /* Session busy; retry after the current operation. */
      }
      if (!stopped) timer = setTimeout(poll, 200);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      void invoke("editor_transport", { action: "pause" }).catch(() => {});
    };
  }, []);
  return (
    <section className="mt-3">
      <h3 className="editor-section-title">Dynamic Trim</h3>
      <div className="flex gap-1 flex-wrap">
        <select
          aria-label="Dynamic trim mode"
          className="editor-input"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="trim">Regular</option>
          <option value="ripple">Ripple</option>
          <option value="roll">Roll</option>
        </select>
        {(["in", "out"] as const).map((edge) => (
          <Button
            key={edge}
            onClick={() =>
              run("trim.selectEditPoint", { clip: integer(clip), edge, kind })
            }
          >
            Select {edge === "in" ? "In" : "Out"}
          </Button>
        ))}
      </div>
      {monitor?.active && (
        <>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {(["outgoing", "incoming"] as const).map((side) => (
              <figure key={side}>
                {monitor[side] ? (
                  <FramePreview
                    item={monitor[side].item}
                    time={monitor[side].mediaTime}
                    revision={monitor.revision}
                    width={320}
                    label={side}
                  />
                ) : (
                  <div className="editor-empty">No {side} clip</div>
                )}
                <figcaption className="editor-hint">
                  {side === "outgoing" ? "Outgoing" : "Incoming"}
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="flex gap-1 flex-wrap my-2">
            <Button
              onClick={() => run("trim.shuttle", { direction: "reverse" })}
            >
              Reverse · J
            </Button>
            <Button onClick={() => run("trim.shuttleStop")}>Stop · K</Button>
            <Button
              onClick={() => run("trim.shuttle", { direction: "forward" })}
            >
              Forward · L
            </Button>
            <Button onClick={() => run("trim.playAround", { toggle: true })}>
              {monitor.playAround ? "Stop Loop" : "Loop Edit"}
            </Button>
            {monitor.dynamic && (
              <Button onClick={() => run("trim.cancelDynamic")}>
                Cancel Trim
              </Button>
            )}
          </div>
          {monitor.dynamic && (
            <p className="editor-hint" role="status">
              {monitor.dynamic.offsetFrames} frames · {monitor.dynamic.speed}×
              {monitor.dynamic.atLimit ? " · Media limit" : ""}
            </p>
          )}
        </>
      )}
      {error && (
        <p className="text-caption text-destructive" role="alert">
          {error}
        </p>
      )}
      <p className="editor-hint mt-2">
        Select an edit point, then use J/K/L to trim. Hold Shift for quarter
        speed. Stop commits one undo step.
      </p>
    </section>
  );
}
