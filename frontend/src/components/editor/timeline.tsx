import { TransitionDialog } from "./transition";
import { FramePreview } from "./frame-preview";
import { Waveform } from "./waveform";
import { useEffect, useRef, useState } from "react";
import {
  Scissors,
  Trash2,
  Magnet,
  Plus,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/contexts/editor-state";
import {
  frameTick,
  integer,
  seconds,
  tickAtSeconds,
  timecode,
  TICKS_PER_SECOND,
} from "@/lib/editor-time";
import type { Clip, Track, Params } from "@/types/editor";
import { timelineScrubTime } from "@/lib/timeline-scrub";

export function EditorTimeline({
  time,
  onSeek,
}: {
  time: string;
  onSeek: (time: string, options?: { flush?: boolean }) => void;
}) {
  const { snapshot, execute } = useEditor();
  const [transition, setTransition] = useState<string | null>(null);
  const [zoom, setZoom] = useState(60);
  const [tool, setTool] = useState("select");
  useEffect(() => {
    const set = (e: Event) => setTool((e as CustomEvent<string>).detail);
    window.addEventListener("editor-tool", set);
    return () => window.removeEventListener("editor-tool", set);
  }, []);
  const [scroll, setScroll] = useState({ left: 0, width: 1000 });
  const scrub = useRef<{ pointer: number; ruler: HTMLDivElement } | null>(null);
  const clearScrub = () => {
    const active = scrub.current;
    scrub.current = null;
    if (!active) return;
    active.ruler.classList.remove("is-scrubbing");
    if (active.ruler.hasPointerCapture(active.pointer))
      active.ruler.releasePointerCapture(active.pointer);
  };
  useEffect(() => {
    window.addEventListener("blur", clearScrub);
    return () => {
      window.removeEventListener("blur", clearScrub);
      clearScrub();
    };
  }, [snapshot?.path, snapshot?.state.active_sequence]);
  const seq = snapshot?.sequence;
  const tracks = seq
    ? [...seq.video_tracks].reverse().concat(seq.audio_tracks)
    : [];
  const duration = Math.max(10, seconds(snapshot?.duration ?? "0") + 3);
  const width = Math.max(500, duration * zoom);
  const selected = snapshot?.state.selection ?? [];
  const run = (id: string, params: Params = {}) => {
    void execute(id, params).catch(() => {});
  };
  function scrubTo(e: React.PointerEvent<HTMLDivElement>, flush = false) {
    if (!seq) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(
      timelineScrubTime(e.clientX, rect.left, rect.width, zoom, seq.settings.frame_rate),
      { flush },
    );
  }
  if (!seq)
    return (
      <div className="editor-empty">
        <p>Create a sequence or drag media into the viewer to begin.</p>
        <Button
          onClick={() => run("file.newSequence", { name: "Edit", fps: 30 })}
        >
          New Sequence
        </Button>
      </div>
    );
  return (
    <section className="editor-timeline" aria-label="Timeline">
      <div className="editor-panel-toolbar">
        <select
          aria-label="Active sequence"
          className="editor-input max-w-48"
          value={snapshot?.state.active_sequence ?? ""}
          onChange={(e) =>
            run("sequence.open", { item: integer(e.target.value) })
          }
        >
          {Object.values(snapshot?.project.items ?? {})
            .filter((i) => i.kind.Sequence)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </select>
        <Button
          size="icon"
          variant="ghost"
          title="Split at playhead (⌘K)"
          aria-label="Split at playhead"
          onClick={() => run("sequence.addEdit", { time: integer(time) })}
        >
          <Scissors />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Delete selected clips"
          aria-label="Delete selected clips"
          disabled={!selected.length}
          onClick={() => run("edit.clear")}
        >
          <Trash2 />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Toggle snapping"
          title="Snapping"
          aria-pressed={snapshot?.state.snapping}
          className={snapshot?.state.snapping ? "bg-fill" : ""}
          onClick={() => run("sequence.snap")}
        >
          <Magnet />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          title="Add video and audio tracks"
          aria-label="Add tracks"
          onClick={() => run("sequence.addTracks", { video: 1, audio: 1 })}
        >
          <Plus />
        </Button>
        <select
          aria-label="Timeline tool"
          className="editor-input"
          value={tool}
          onChange={(e) => setTool(e.target.value)}
        >
          {[
            ["select", "Select"],
            ["ripple", "Ripple"],
            ["roll", "Roll"],
            ["slip", "Slip"],
            ["slide", "Slide"],
            ["rate", "Rate Stretch"],
            ["razor", "Razor"],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <span className="flex-1" />
        <span className="text-caption tabular-nums">
          {timecode(time, seq.settings.frame_rate, seq.settings.drop_frame)}
        </span>
        <input
          aria-label="Timeline zoom"
          type="range"
          min="10"
          max="240"
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-20 accent-accent"
        />
      </div>
      <div
        className="editor-track-scroll"
        onScroll={(e) =>
          setScroll({
            left: e.currentTarget.scrollLeft,
            width: e.currentTarget.clientWidth,
          })
        }
        tabIndex={0}
        aria-label="Tracks"
      >
        <div
          className="relative"
          style={{ width: width + 112, minHeight: tracks.length * 58 + 28 }}
        >
          <div
            className="editor-ruler"
            style={{ width, marginLeft: 112 }}
            onPointerDown={(e) => {
              if (e.button !== 0 || !e.isPrimary || scrub.current) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              scrub.current = { pointer: e.pointerId, ruler: e.currentTarget };
              e.currentTarget.classList.add("is-scrubbing");
              scrubTo(e);
            }}
            onPointerMove={(e) => {
              if (scrub.current?.pointer === e.pointerId) scrubTo(e);
            }}
            onPointerUp={(e) => {
              if (scrub.current?.pointer !== e.pointerId) return;
              scrubTo(e, true);
              clearScrub();
            }}
            onPointerCancel={(e) => {
              if (scrub.current?.pointer === e.pointerId) clearScrub();
            }}
            onLostPointerCapture={(e) => {
              if (scrub.current?.pointer === e.pointerId) clearScrub();
            }}
          >
            {Array.from(
              { length: Math.ceil(scroll.width / 80) + 3 },
              (_, i) =>
                (Math.floor(
                  Math.max(0, scroll.left - 112) /
                    (Math.max(1, Math.ceil(80 / zoom)) * zoom),
                ) +
                  i) *
                Math.max(1, Math.ceil(80 / zoom)),
            )
              .filter((t) => t <= duration)
              .map((t) => (
                <span key={t} style={{ left: t * zoom }}>
                  {timecode(
                    tickAtSeconds(t),
                    seq.settings.frame_rate,
                    seq.settings.drop_frame,
                  )}
                </span>
              ))}
            {seq.markers.map((m) => (
              <button
                key={m.id}
                aria-label={`Marker ${m.name}`}
                title={m.name}
                className="absolute top-0 text-accent z-10"
                style={{ left: seconds(m.start) * zoom }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onSeek(m.start);
                }}
              >
                ◆
              </button>
            ))}
          </div>
          {tracks.map((track) => (
            <div
              key={track.id}
              className="editor-track-row"
              data-track={track.id}
            >
              <div className="editor-track-label">
                <span className="truncate font-medium">{track.name}</span>
                <div className="flex gap-1">
                  <button
                    title={track.locked ? "Unlock track" : "Lock track"}
                    aria-label={`${track.locked ? "Unlock" : "Lock"} ${track.name}`}
                    onClick={() =>
                      run("timeline.setTrack", {
                        track: integer(track.id),
                        locked: !track.locked,
                      })
                    }
                  >
                    {track.locked ? <Lock /> : <Unlock />}
                  </button>
                  <button
                    title="Toggle output"
                    aria-label={`Toggle ${track.name} output`}
                    onClick={() =>
                      run("timeline.setTrack", {
                        track: integer(track.id),
                        enabled: !track.enabled,
                        muted: track.enabled,
                      })
                    }
                  >
                    {track.enabled && !track.muted ? <Volume2 /> : <VolumeX />}
                  </button>
                </div>
              </div>
              <div
                className="editor-track-content"
                style={{ width }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const item = e.dataTransfer.getData(
                    "application/x-asmr-media",
                  );
                  if (item && !track.locked)
                    run("timeline.place", {
                      item: integer(item),
                      track: integer(track.id),
                      time: integer(
                        tickAtSeconds(
                          Math.max(
                            0,
                            (e.clientX -
                              e.currentTarget.getBoundingClientRect().left) /
                              zoom,
                          ),
                        ),
                      ),
                    });
                }}
              >
                {track.items
                  .filter(
                    (c) =>
                      seconds(c.start) * zoom +
                        Math.max(18, seconds(c.duration) * zoom) >=
                        scroll.left - 112 &&
                      seconds(c.start) * zoom <= scroll.left + scroll.width,
                  )
                  .map((clip) => (
                    <TimelineClip
                      key={clip.id}
                      clip={clip}
                      track={track}
                      zoom={zoom}
                      tool={tool}
                      time={time}
                      snap={!!snapshot?.state.snapping}
                      tracks={tracks}
                      selection={selected}
                      selected={selected.includes(clip.id)}
                      rate={seq.settings.frame_rate}
                      onCommand={run}
                    />
                  ))}
                {track.transitions.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTransition(t.id)}
                    aria-label={`Edit ${t.effect.effect} transition`}
                    title={t.effect.effect}
                    className="editor-transition"
                    style={{
                      left: seconds(t.start) * zoom,
                      width: Math.max(5, seconds(t.duration) * zoom),
                    }}
                  >
                    ⋈
                  </button>
                ))}
              </div>
            </div>
          ))}
          {seq.caption_tracks.map((track) => (
            <div key={track.id} className="editor-track-row">
              <div className="editor-track-label">{track.name}</div>
              <div className="editor-track-content" style={{ width }}>
                {track.captions.map((c) => (
                  <button
                    key={c.id}
                    className="editor-clip text-caption px-2 text-left truncate"
                    style={{
                      left: seconds(c.start) * zoom,
                      width: Math.max(18, seconds(c.duration) * zoom),
                    }}
                    onClick={() => onSeek(c.start)}
                  >
                    {c.text}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div
            className="editor-playhead"
            style={{ left: 112 + seconds(time) * zoom }}
            aria-hidden="true"
          >
            <span />
          </div>
        </div>
      </div>
      {transition && (
        <TransitionDialog id={transition} onClose={() => setTransition(null)} />
      )}
    </section>
  );
}

function TimelineClip({
  clip,
  track,
  zoom,
  selected,
  rate,
  onCommand,
  tool,
  time,
  snap,
  tracks,
  selection,
}: {
  tool: string;
  time: string;
  snap: boolean;
  tracks: Track[];
  selection: string[];
  clip: Clip;
  track: Track;
  zoom: number;
  selected: boolean;
  rate: { num: string; den: string };
  onCommand: (id: string, p?: Params) => void;
}) {
  const { snapshot } = useEditor();
  const drag = useRef<{ x: number; edge?: "in" | "out"; dx: number } | null>(
    null,
  );
  const [offset, setOffset] = useState(0);
  function start(
    e: React.PointerEvent<HTMLButtonElement>,
    edge?: "in" | "out",
  ) {
    if (track.locked) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, dx: 0, edge };
    if (!selected || e.metaKey || e.shiftKey)
      onCommand("timeline.select", {
        clips: [integer(clip.id)],
        toggle: e.metaKey || e.shiftKey,
        linked: true,
      });
    if (tool === "razor") {
      onCommand("timeline.razor", {
        clip: integer(clip.id),
        time: integer(
          BigInt(clip.start) +
            tickAtSeconds(
              (e.clientX - e.currentTarget.getBoundingClientRect().left) / zoom,
            ),
        ),
      });
      drag.current = null;
    }
  }
  function finish(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    setOffset(0);
    if (!d || Math.abs(d.dx) < 3) return;
    const frames = Math.round(
      ((d.dx / zoom) * Number(rate.num)) / Number(rate.den),
    );
    if (tool === "slip" || tool === "slide") {
      onCommand(`timeline.${tool}`, {
        clip: integer(clip.id),
        deltaFrames: frames,
      });
      return;
    }
    if (d.edge && tool === "rate") {
      onCommand("timeline.rateStretch", {
        clip: integer(clip.id),
        edge: d.edge,
        delta: integer(frameTick(BigInt(frames), rate)),
      });
      return;
    }
    if (d.edge && tool === "roll") {
      const ordered = [...track.items].sort((a, b) =>
        Number(BigInt(a.start) - BigInt(b.start)),
      );
      const i = ordered.findIndex((c) => c.id === clip.id);
      const left = d.edge === "in" ? ordered[i - 1] : clip,
        right = d.edge === "in" ? clip : ordered[i + 1];
      if (left && right)
        onCommand("timeline.roll", {
          left: integer(left.id),
          right: integer(right.id),
          deltaFrames: frames,
          followLinks: true,
        });
      return;
    }
    if (d.edge)
      onCommand("timeline.trim", {
        clip: integer(clip.id),
        edge: d.edge,
        mode: e.altKey || tool === "ripple" ? "ripple" : "regular",
        deltaFrames: frames,
      });
    else {
      const under =
        document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest("[data-track]")
          ?.getAttribute("data-track") ?? track.id;
      let at = BigInt(clip.start) + frameTick(BigInt(frames), rate);
      const moving = selection.includes(clip.id) ? selection : [clip.id];
      if (snap && !e.altKey) {
        const boundaries = [
          0n,
          BigInt(time),
          ...tracks.flatMap((t) =>
            t.items
              .filter((c) => !moving.includes(c.id))
              .flatMap((c) => [
                BigInt(c.start),
                BigInt(c.start) + BigInt(c.duration),
              ]),
          ),
        ];
        let best = tickAtSeconds(8 / zoom),
          correction = 0n;
        for (const target of boundaries)
          for (const edge of [0n, BigInt(clip.duration)]) {
            const delta = target - (at + edge);
            if ((delta < 0n ? -delta : delta) < best) {
              best = delta < 0n ? -delta : delta;
              correction = delta;
            }
          }
        at += correction;
      }
      at = at < 0n ? 0n : at;
      const delta = at - BigInt(clip.start);
      const moves = tracks.flatMap((t) =>
        t.items
          .filter((c) => moving.includes(c.id))
          .map((c) => ({
            clip: integer(c.id),
            track: integer(c.id === clip.id ? under : t.id),
            time: integer(
              BigInt(c.start) + delta < 0n ? 0n : BigInt(c.start) + delta,
            ),
          })),
      );
      onCommand("timeline.move", {
        moves,
        linked: true,
        insert: e.metaKey,
        copy: e.altKey,
      });
    }
  }
  const pointer = {
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (drag.current) {
        drag.current.dx = e.clientX - drag.current.x;
        setOffset(drag.current.dx);
      }
    },
    onPointerUp: finish,
    onPointerCancel: () => {
      drag.current = null;
      setOffset(0);
    },
  };
  const length = Math.max(18, seconds(clip.duration) * zoom);
  return (
    <div
      className={`editor-clip ${selected ? "is-selected" : ""} ${track.kind === "Audio" ? "is-audio" : ""}`}
      style={{
        left: seconds(clip.start) * zoom,
        width: length,
        transform: !drag.current?.edge ? `translateX(${offset}px)` : undefined,
        opacity: clip.enabled ? 1 : 0.4,
      }}
    >
      {track.kind === "Video" && snapshot && length > 60 && (
        <div className="absolute left-0 top-0 h-full opacity-60 pointer-events-none">
          <FramePreview
            item={clip.item}
            time={clip.source_in}
            revision={snapshot.revision}
          />
        </div>
      )}
      {track.kind === "Audio" && snapshot && (
        <Waveform
          item={clip.item}
          start={clip.source_in}
          duration={tickAtSeconds(
            seconds(clip.duration) * Math.abs(clip.speed),
          ).toString()}
          stream={Number(clip.audio_stream ?? 0)}
          revision={snapshot.revision}
          reverse={clip.reverse}
          gain={clip.gain_db}
        />
      )}
      <button
        className="editor-trim-handle left-0"
        aria-label={`Trim start of ${clip.name}`}
        onPointerDown={(e) => start(e, "in")}
        {...pointer}
      />
      <button
        className="editor-clip-body"
        aria-label={`${clip.name}, ${seconds(clip.duration).toFixed(2)} seconds`}
        aria-pressed={selected}
        onClick={(e) => {
          if (e.detail === 0)
            onCommand("timeline.select", {
              clips: [integer(clip.id)],
              linked: true,
            });
        }}
        onPointerDown={(e) => start(e)}
        {...pointer}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const delta = frameTick(
              BigInt((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 5 : 1)),
              rate,
            );
            const time = BigInt(clip.start) + delta;
            onCommand("timeline.move", {
              moves: [
                {
                  clip: integer(clip.id),
                  track: integer(track.id),
                  time: integer(time < 0n ? 0n : time),
                },
              ],
              linked: true,
            });
          }
        }}
      >
        <span className="truncate">{clip.name}</span>
        <small>
          {(
            Number((BigInt(clip.duration) * 100n) / TICKS_PER_SECOND) / 100
          ).toFixed(2)}
          s
        </small>
      </button>
      <button
        className="editor-trim-handle right-0"
        aria-label={`Trim end of ${clip.name}`}
        onPointerDown={(e) => start(e, "out")}
        {...pointer}
      />
    </div>
  );
}
