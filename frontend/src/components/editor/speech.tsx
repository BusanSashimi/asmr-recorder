import { useEffect, useState } from "react";
import { useEditor } from "@/contexts/editor-state";
import { Button } from "@/components/ui/button";
import { integer } from "@/lib/editor-time";
import { CommandsPanel } from "./commands";
interface Word {
  i: string;
  text: string;
  start: string;
  end: string;
  speaker: string;
}
interface Model {
  id: string;
  name: string;
  size: string;
  license: string;
  source: string;
  installed: boolean;
}
export function TranscriptPanel({ onSeek }: { onSeek: (t: string) => void }) {
  const { snapshot, execute, query } = useEditor();
  const [words, setWords] = useState<Word[]>([]),
    [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("whisper-base"),
    [search, setSearch] = useState("");
  const [from, setFrom] = useState<number | null>(null),
    [to, setTo] = useState<number | null>(null);
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void query("transcript.inspect")
      .then((v) => {
        if (live) setWords((v as { words: Word[] }).words);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [query, snapshot?.revision]);
  useEffect(() => {
    void query("transcript.models")
      .then((v) => setModels((v as { models: Model[] }).models))
      .catch((e) => setError(String(e)));
  }, [query, working]);
  const selected = models.find((m) => m.id === model);
  async function run(command: string, params = {}) {
    setWorking(true);
    try {
      await execute(command, params);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }
  const range = {
    from: Math.min(from ?? 0, to ?? from ?? 0),
    to: Math.max(from ?? 0, to ?? from ?? 0),
  };
  return (
    <div className="editor-panel-body">
      <h3 className="editor-section-title">Transcript</h3>
      <select
        className="editor-input w-full"
        aria-label="Speech model"
        value={model}
        onChange={(e) => setModel(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
            {m.installed ? " · Installed" : ""}
          </option>
        ))}
      </select>
      {selected && !selected.installed && (
        <div className="my-2">
          <p className="editor-hint">
            Download {Math.round(Number(selected.size) / 1e6)} MB ·{" "}
            {selected.license}
            <br />
            Source: {selected.source}
          </p>
          <Button
            disabled={working}
            onClick={() => {
              void run("transcript.downloadModel", { model });
            }}
          >
            Download Selected Model
          </Button>
        </div>
      )}
      <Button
        className="my-2"
        disabled={working || !selected?.installed || !snapshot?.sequence}
        onClick={() => {
          void run("transcript.generate", {
            model,
            language: "auto",
            diarize: true,
          });
        }}
      >
        {working ? "Working…" : "Transcribe Sequence"}
      </Button>
      <input
        className="editor-input w-full mb-3"
        aria-label="Find transcript text"
        placeholder="Find words…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="flex gap-1 flex-wrap mb-3">
        {[
          ["transcript.select", "Mark"],
          ["transcript.lift", "Lift"],
          ["transcript.extract", "Extract"],
        ].map(([id, label]) => (
          <Button
            size="sm"
            key={id}
            disabled={from === null || working}
            onClick={() => {
              void run(id, range);
            }}
          >
            {label}
          </Button>
        ))}
        <Button
          size="sm"
          disabled={!words.length || working}
          onClick={() => {
            void run("transcript.createCaptions");
          }}
        >
          Create Captions
        </Button>
      </div>
      <p className="editor-hint mb-2">
        Click a word to seek. Shift-click another word to select a passage.
      </p>
      <div className="text-callout leading-8">
        {words.map((w, i) => (
          <button
            key={`${w.i}-${w.start}`}
            className={`px-1 rounded ${from !== null && i >= range.from && i <= range.to ? "bg-accent text-accent-foreground" : search && w.text.toLowerCase().includes(search.toLowerCase()) ? "bg-fill-hover" : ""}`}
            aria-pressed={from !== null && i >= range.from && i <= range.to}
            onClick={(e) => {
              if (e.shiftKey && from !== null) setTo(i);
              else {
                setFrom(i);
                setTo(i);
              }
              onSeek(w.start);
            }}
          >
            {w.text}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-caption">
          {error}
        </p>
      )}
      <details>
        <summary className="editor-section-title">Transcript Actions</summary>
        <CommandsPanel category="transcript" />
      </details>
    </div>
  );
}
interface Voices {
  defaultVoice: string;
  voices: { id: string; name: string; language: string; installed: boolean }[];
  package: {
    installed: boolean;
    size?: string;
    license?: string;
    source?: string;
  };
}
export function NarrationPanel({ time }: { time: string }) {
  const { snapshot, execute, query } = useEditor();
  const [catalog, setCatalog] = useState<Voices | null>(null),
    [voice, setVoice] = useState(""),
    [script, setScript] = useState(""),
    [pace, setPace] = useState("1");
  const [working, setWorking] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    void query("tts.voices")
      .then((v) => {
        const c = v as Voices;
        setCatalog(c);
        setVoice((x) => x || c.defaultVoice);
      })
      .catch((e) => setError(String(e)));
  }, [query, working]);
  async function run(id: string, params = {}) {
    setWorking(true);
    try {
      await execute(id, params);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="editor-panel-body">
      <h3 className="editor-section-title">Narration</h3>
      <textarea
        className="editor-input w-full min-h-32"
        aria-label="Narration script"
        placeholder="Write your narration…"
        value={script}
        onChange={(e) => setScript(e.target.value)}
      />
      <label className="text-caption block mt-2">
        Voice
        <select
          className="editor-input w-full"
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
        >
          {catalog?.voices.map((v) => (
            <option key={v.id} value={v.id} disabled={!v.installed}>
              {v.name} · {v.language}
              {!v.installed ? " · Download required" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="text-caption block mt-2">
        Pace
        <input
          type="number"
          min="0.5"
          max="2"
          step="0.1"
          className="editor-input w-full"
          value={pace}
          onChange={(e) => setPace(e.target.value)}
        />
      </label>
      <Button
        className="mt-2"
        disabled={working || !script || !snapshot?.sequence}
        onClick={() => {
          void run("tts.create", {
            text: script,
            voice,
            pace: Number(pace),
            time: integer(time),
          });
        }}
      >
        Add Narration at Playhead
      </Button>
      {catalog && !catalog.package.installed && (
        <details>
          <summary className="editor-section-title">Natural Voices</summary>
          <p className="editor-hint">
            {catalog.package.license} · {catalog.package.source}
            {catalog.package.size
              ? ` · ${Math.round(Number(catalog.package.size) / 1e6)} MB`
              : ""}
          </p>
          <Button
            disabled={working}
            onClick={() => {
              void run("tts.downloadVoices", { wait: false });
            }}
          >
            Download Natural Voices
          </Button>
        </details>
      )}
      <h3 className="editor-section-title mt-4">Record Voice-over</h3>
      <p className="editor-hint">
        Record a microphone take onto the active sequence. Use In and Out marks
        for punch recording.
      </p>
      <Button
        className="mt-2"
        variant={snapshot?.voiceover ? "destructive" : "default"}
        disabled={working || !snapshot?.sequence}
        onClick={() => {
          void run(
            snapshot?.voiceover
              ? "audio.voiceover.stop"
              : "audio.voiceover.start",
          );
        }}
      >
        {snapshot?.voiceover ? "Stop & Save Voice-over" : "Record Voice-over"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-caption">
          {error}
        </p>
      )}
      <details>
        <summary className="editor-section-title">Voice-over Settings</summary>
        <CommandsPanel category="audio.voiceover" />
      </details>
      <details>
        <summary className="editor-section-title">Narration Actions</summary>
        <CommandsPanel category="tts" />
      </details>
    </div>
  );
}
