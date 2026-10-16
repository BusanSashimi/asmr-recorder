import { useCallback, useEffect, useRef, useState } from "react";
import { Waveform } from "./waveform";
import { invoke } from "@tauri-apps/api/core";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Film,
  Repeat2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/contexts/editor-state";
import {
  frameTick,
  timecode,
  integer,
  seconds,
  tickAtSeconds,
} from "@/lib/editor-time";

export interface Transport {
  playing: boolean;
  speed: number;
  looping: boolean;
  time: string;
  sourceTime: string;
  target: "source" | "program";
  note?: string;
}
export function EditorViewer({
  time,
  onTime,
  transportRef,
  source = false,
}: {
  source?: boolean;
  time: string;
  onTime: (time: string) => void;
  transportRef: React.MutableRefObject<
    ((action: string, time?: string) => Promise<void>) | null
  >;
}) {
  const { snapshot, execute } = useEditor();
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState({ speed: 1, looping: false });
  const [note, setNote] = useState<string | null>(null);
  const timeRef = useRef(time);
  const revisionRef = useRef(snapshot?.revision);
  const lastFrame = useRef("");
  timeRef.current = time;
  revisionRef.current = snapshot?.revision;
  const transport = useCallback(
    async (action: string, at?: string) => {
      try {
        const status = await invoke<Transport>("editor_transport", {
          action:
            source && action === "play"
              ? "sourcePlay"
              : source && action === "seek"
                ? "sourceSeek"
                : action,
          time: at ?? null,
        });
        setPlayback({ speed: status.speed, looping: status.looping });
        setPlaying(
          status.playing && status.target === (source ? "source" : "program"),
        );
        onTime(source ? status.sourceTime : status.time);
        setNote(status.note ?? null);
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [onTime, source],
  );
  useEffect(() => {
    transportRef.current = transport;
    return () => {
      transportRef.current = null;
    };
  }, [transport, transportRef]);
  const sourceItem = snapshot?.source?.item;
  const sourceMedia = snapshot?.source?.media;
  const audioOnly =
    source &&
    !!sourceMedia &&
    !!snapshot?.project.items[sourceMedia]?.kind.Media?.info.audio &&
    !snapshot?.project.items[sourceMedia]?.kind.Media?.info.video;
  useEffect(() => {
    if (!(source ? sourceItem : snapshot?.state.active_sequence)) return;
    let cancelled = false;
    let wasActive = false;
    let timer: ReturnType<typeof setTimeout>;
    async function frame() {
      try {
        const status = await invoke<Transport>("editor_transport", {
          action: "status",
          time: null,
        });
        if (cancelled) return;
        const active =
          status.playing && status.target === (source ? "source" : "program");
        setPlayback({ speed: status.speed, looping: status.looping });
        setNote(status.note ?? null);
        setPlaying(active);
        if (active || wasActive)
          onTime(source ? status.sourceTime : status.time);
        const at =
          active || wasActive
            ? source
              ? status.sourceTime
              : status.time
            : timeRef.current;
        wasActive = active;
        const rev = revisionRef.current;
        const width = Math.round(viewer.current?.clientWidth ?? 640);
        const key = `${rev}:${at}:${width}`;
        if (!audioOnly && key !== lastFrame.current) {
          const raw = await invoke<ArrayBuffer>("editor_frame", {
            time: at,
            width,
            source,
          });
          if (
            cancelled ||
            rev !== revisionRef.current ||
            (!status.playing && at !== timeRef.current)
          )
            return;
          const buffer =
            raw instanceof ArrayBuffer ? raw : new Uint8Array(raw).buffer;
          const header = new DataView(buffer);
          const w = header.getUint32(0, true),
            h = header.getUint32(4, true);
          if (w * h * 4 + 8 !== buffer.byteLength)
            throw new Error("Invalid preview frame");
          const el = canvas.current;
          if (el) {
            el.width = w;
            el.height = h;
            el.getContext("2d")?.putImageData(
              new ImageData(new Uint8ClampedArray(buffer, 8), w, h),
              0,
              0,
            );
          }
          lastFrame.current = key;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled)
          timer = setTimeout(
            () => {
              void frame();
            },
            playing ? 16 : 80,
          );
      }
    }
    void frame();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    snapshot?.state.active_sequence,
    sourceItem,
    onTime,
    playing,
    source,
    audioOnly,
  ]);
  useEffect(
    () => () => {
      void invoke("editor_transport", { action: "pause", time: null }).catch(
        () => {},
      );
    },
    [],
  );
  const seq = snapshot?.sequence;
  const ready = source ? !!snapshot?.source : !!seq;
  const rate = source
    ? (snapshot?.source?.rate ?? { num: "30", den: "1" })
    : (seq?.settings.frame_rate ?? { num: "30", den: "1" });
  const duration = source ? snapshot?.source?.end : snapshot?.duration;
  const run = (command: string) => {
    void execute(command, {
      target: source ? "source" : "program",
      time: integer(time),
    }).catch(() => {});
  };
  return (
    <section
      className="editor-viewer"
      aria-label={source ? "Source viewer" : "Program viewer"}
      ref={viewer}
    >
      <div
        className="editor-viewer-stage"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData("application/x-asmr-media");
          if (id)
            void execute("file.newSequence", {
              name: snapshot?.project.items[id]?.name ?? "Edit",
              fromItem: { $integer: id },
            }).catch(() => {});
        }}
      >
        {ready ? (
          audioOnly && snapshot?.source ? (
            <div className="relative w-full h-1/2 text-accent">
              <Waveform
                item={snapshot.source.media}
                start={snapshot.source.start}
                duration={String(
                  BigInt(snapshot.source.end) - BigInt(snapshot.source.start),
                )}
                revision={snapshot.revision}
              />
              <span
                className="absolute top-0 bottom-0 border-l border-accent"
                style={{
                  left: `${(100 * (seconds(time) - seconds(snapshot.source.start))) / Math.max(0.001, seconds(snapshot.source.end) - seconds(snapshot.source.start))}%`,
                }}
              />
            </div>
          ) : (
            <canvas ref={canvas} aria-label="Sequence preview" />
          )
        ) : (
          <div className="text-center text-white/70 px-6">
            <Film className="h-10 w-10 mx-auto mb-4 opacity-50" />
            <p className="text-title">
              {source ? "Select a clip in Media" : "Your edit starts here"}
            </p>
            <p className="text-callout mt-2">
              {source
                ? "Preview and mark a source before inserting it."
                : "Import media to create a sequence. Recordings arrive here automatically."}
            </p>
          </div>
        )}
        {error && (
          <p role="status" className="editor-viewer-message">
            {error}
          </p>
        )}
      </div>
      {source && ready && (
        <input
          type="range"
          className="w-full accent-accent mt-2"
          aria-label="Source position"
          min={seconds(snapshot?.source?.start ?? "0")}
          max={seconds(duration ?? "0")}
          step={1 / (snapshot?.source?.fps ?? 30)}
          value={seconds(time)}
          onChange={(e) => {
            void transport(
              "seek",
              String(tickAtSeconds(Number(e.target.value))),
            );
          }}
        />
      )}
      <div className="editor-transport">
        <span className="text-caption tabular-nums mr-auto">
          {timecode(time, rate, !source && seq?.settings.drop_frame)}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Previous frame"
          disabled={!ready}
          onClick={() => {
            const n = BigInt(time) - frameTick(1n, rate);
            void transport("seek", String(n < 0n ? 0n : n));
          }}
        >
          <SkipBack />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={playing ? "Pause" : "Play"}
          disabled={!ready}
          onClick={() => {
            void transport(playing ? "pause" : "play");
          }}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Next frame"
          disabled={!ready}
          onClick={() => {
            void transport("seek", String(BigInt(time) + frameTick(1n, rate)));
          }}
        >
          <SkipForward />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Loop playback"
          aria-pressed={playback.looping}
          className={playback.looping ? "bg-fill" : ""}
          onClick={() => {
            void transport("loop");
          }}
        >
          <Repeat2 />
        </Button>
        {playing && playback.speed !== 1 && (
          <span className="text-caption">{playback.speed}×</span>
        )}
        <span className="text-caption tabular-nums ml-auto">
          {timecode(duration ?? "0", rate, !source && seq?.settings.drop_frame)}
        </span>
      </div>
      {ready && (
        <div className="flex flex-wrap justify-center gap-1">
          <Button size="sm" onClick={() => run("markers.markIn")}>
            Mark In
          </Button>
          <Button size="sm" onClick={() => run("markers.markOut")}>
            Mark Out
          </Button>
          <Button size="sm" onClick={() => run("markers.clearInOut")}>
            Clear Marks
          </Button>
          {source && (
            <>
              <Button
                size="sm"
                disabled={!seq}
                onClick={() => run("source.insert")}
              >
                Insert
              </Button>
              <Button
                size="sm"
                disabled={!seq}
                onClick={() => run("source.overwrite")}
              >
                Overwrite
              </Button>
            </>
          )}
        </div>
      )}
      {note && <p className="editor-hint px-3">{note}</p>}
    </section>
  );
}

export function SourceViewer() {
  const { snapshot } = useEditor();
  const sourceItem = snapshot?.source?.item;
  const [local, setLocal] = useState<{
    item: string | undefined;
    time: string;
  } | null>(null);
  const time =
    local?.item === sourceItem
      ? (local?.time ?? "0")
      : (snapshot?.source?.playhead ?? "0");
  const setTime = useCallback(
    (time: string) => setLocal({ item: sourceItem, time }),
    [sourceItem],
  );
  const transportRef = useRef<
    ((action: string, time?: string) => Promise<void>) | null
  >(null);
  return (
    <EditorViewer
      source
      time={time}
      onTime={setTime}
      transportRef={transportRef}
    />
  );
}
