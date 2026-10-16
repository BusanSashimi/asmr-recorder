import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/contexts/editor-state";
import { integer } from "@/lib/editor-time";
import { Button } from "@/components/ui/button";
import { NumberField, ParameterControl } from "./effects";
import { CommandsPanel } from "./commands";
interface Strip {
  id: string;
  name: string;
  ref: string;
  kind: string;
  mode: string;
  volumeDb: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  recordArm: boolean;
  output: string;
  channels: string;
  at: { volumeDb: number; pan: number };
  inserts: {
    slot: string;
    effect: string;
    name: string;
    enabled: boolean;
    params: Record<string, number | boolean>;
  }[];
}
export function MixerPanel() {
  const { snapshot, execute, query, effects } = useEditor();
  const [strips, setStrips] = useState<Strip[]>([]),
    [meters, setMeters] = useState<Record<string, number[]>>({}),
    [error, setError] = useState("");
  const sequenceId = snapshot?.state.active_sequence;
  useEffect(() => {
    if (!sequenceId) return;
    let live = true;
    void query("mixer.inspect")
      .then((v) => {
        if (live) setStrips((v as { strips: Strip[] }).strips);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [query, snapshot?.revision, sequenceId]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const v = await query("mixer.meters");
        if (live) setMeters(v as Record<string, number[]>);
      } catch {
        /* no meter when session unavailable */
      }
      if (live)
        timer = setTimeout(() => {
          void poll();
        }, 100);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  const run = (id: string, p = {}) => {
    void execute(id, p).catch((e) => setError(String(e)));
  };
  return (
    <div className="editor-panel-body">
      <Button
        size="sm"
        disabled={!snapshot?.sequence}
        onClick={() =>
          run("mixer.addSubmix", { name: "Submix", channels: "Stereo" })
        }
      >
        Add Submix
      </Button>
      {(sequenceId ? strips : []).map((t) => (
        <section key={t.id} className="editor-effect">
          <h3 className="editor-section-title">
            {t.name} · {t.ref}
          </h3>
          <div
            className="flex gap-1 h-3 my-2"
            role="img"
            aria-label={`${t.name} audio levels`}
          >
            {(meters[t.id] ?? [0, 0]).map((v, i) => (
              <div
                key={i}
                className="flex-1 bg-fill rounded-sm overflow-hidden"
              >
                <div
                  className={
                    v >= 0.99 ? "bg-record h-full" : "bg-accent h-full"
                  }
                  style={{
                    width: `${Math.max(0, Math.min(100, ((20 * Math.log10(Math.max(1e-6, v)) + 60) / 60) * 100))}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <Fader strip={t.id} value={t.volumeDb} />
          <label className="text-caption">
            Pan
            <NumberField
              id={`${t.name} pan`}
              value={t.pan}
              min={-100}
              max={100}
              onCommit={(value) =>
                run("mixer.setValue", {
                  strip: integer(t.id),
                  lane: "pan",
                  value,
                })
              }
            />
          </label>
          <div className="flex flex-wrap gap-1 my-2">
            <Button
              size="sm"
              variant={t.muted ? "accent" : "default"}
              onClick={() =>
                run("mixer.setStrip", { strip: integer(t.id), muted: !t.muted })
              }
            >
              Mute
            </Button>
            <Button
              size="sm"
              variant={t.solo ? "accent" : "default"}
              onClick={() =>
                run("mixer.setStrip", { strip: integer(t.id), solo: !t.solo })
              }
            >
              Solo
            </Button>
            {t.kind === "audio" && (
              <Button
                size="sm"
                variant={t.recordArm ? "destructive" : "default"}
                onClick={() =>
                  run("mixer.setStrip", {
                    strip: integer(t.id),
                    recordArm: !t.recordArm,
                  })
                }
              >
                Arm
              </Button>
            )}
          </div>
          <label className="text-caption">
            Automation
            <select
              className="editor-input w-full"
              value={t.mode}
              onChange={(e) =>
                run("mixer.setStrip", {
                  strip: integer(t.id),
                  mode: e.target.value,
                })
              }
            >
              {["Off", "Read", "Latch", "Touch", "Write"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          {t.kind !== "mix" && (
            <label className="text-caption block mt-2">
              Output
              <select
                className="editor-input w-full"
                value={t.output}
                onChange={(e) =>
                  run("mixer.setStrip", {
                    strip: integer(t.id),
                    output: e.target.value,
                  })
                }
              >
                {strips
                  .filter((s) => s.kind !== "audio" && s.id !== t.id)
                  .map((s) => (
                    <option key={s.id} value={s.ref}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <details>
            <summary className="editor-section-title">Track Effects</summary>
            {t.inserts.map((f) => (
              <div
                key={f.slot}
                className="text-caption my-2 border-b border-separator pb-2"
              >
                <input
                  type="checkbox"
                  aria-label={`Enable ${f.name}`}
                  checked={f.enabled}
                  onChange={(e) =>
                    run("mixer.setInsert", {
                      strip: integer(t.id),
                      slot: Number(f.slot),
                      enabled: e.target.checked,
                    })
                  }
                />
                <span className="flex-1">{f.name}</span>
                <Button
                  size="sm"
                  onClick={() =>
                    run("mixer.removeInsert", {
                      strip: integer(t.id),
                      slot: Number(f.slot),
                    })
                  }
                >
                  Remove
                </Button>
                {effects
                  .find((e) => e.id === f.effect)
                  ?.params.map((p) => (
                    <label key={p.id} className="block text-caption mt-2">
                      {p.label}
                      <ParameterControl
                        id={`${t.id}-${f.slot}-${p.id}`}
                        definition={p}
                        value={
                          typeof f.params[p.id] === "boolean"
                            ? { Bool: f.params[p.id] as boolean }
                            : typeof p.kind === "object" && p.kind.Choice
                              ? { Choice: String(f.params[p.id] ?? 0) }
                              : { Float: Number(f.params[p.id] ?? 0) }
                        }
                        onCommit={(value) =>
                          run("mixer.setInsert", {
                            strip: integer(t.id),
                            slot: Number(f.slot),
                            params: { [p.id]: value },
                          })
                        }
                      />
                    </label>
                  ))}
              </div>
            ))}
            <select
              className="editor-input w-full"
              value=""
              aria-label={`Add effect to ${t.name}`}
              onChange={(e) =>
                run("mixer.addInsert", {
                  strip: integer(t.id),
                  effect: e.target.value,
                })
              }
            >
              <option value="" disabled>
                Add Audio Effect…
              </option>
              {effects
                .filter((e) => e.kind === "Audio" && !e.intrinsic)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
            </select>
          </details>
        </section>
      ))}
      {error && (
        <p role="alert" className="editor-error">
          {error}
        </p>
      )}
      <details>
        <summary className="editor-section-title">
          Routing, Sends & Automation
        </summary>
        <CommandsPanel category="mixer" />
      </details>
      <details>
        <summary className="editor-section-title">
          Essential Sound & Audio Tools
        </summary>
        <CommandsPanel category="audio" />
      </details>
    </div>
  );
}
function Fader({ strip, value }: { strip: string; value: number }) {
  const { execute } = useEditor();
  const last = useRef(0),
    touching = useRef(false);
  const [draft, setDraft] = useState<number | null>(null);
  const run = (id: string, p = {}) => {
    void execute(id, { strip: integer(strip), lane: "volume", ...p }).catch(
      () => {},
    );
  };
  return (
    <label className="text-caption block">
      Volume · {(draft ?? value).toFixed(1)} dB
      <input
        className="w-full accent-accent"
        type="range"
        min="-96"
        max="12"
        step=".1"
        value={draft ?? value}
        onPointerDown={() => {
          touching.current = true;
        }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          if (!touching.current) {
            run("mixer.setValue", { value: v });
            setDraft(null);
          } else if (performance.now() - last.current > 80) {
            last.current = performance.now();
            run("mixer.touch", { value: v });
          }
        }}
        onPointerUp={(e) => {
          run("mixer.touch", { value: Number(e.currentTarget.value) });
          run("mixer.release");
          touching.current = false;
          setDraft(null);
        }}
        onPointerCancel={() => {
          run("mixer.release");
          touching.current = false;
          setDraft(null);
        }}
      />
    </label>
  );
}
