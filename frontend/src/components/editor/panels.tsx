import { useState } from "react";
import { Film, Music, FolderOpen, Folder, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/contexts/editor-state";
import type { MediaBin } from "@/types/editor";
import { CommandsPanel } from "./commands";
import { integer, timecode } from "@/lib/editor-time";

export function MediaBrowser() {
  const { snapshot, execute, importFiles } = useEditor();
  const [search, setSearch] = useState("");
  const [binId, setBinId] = useState("0"),
    [binName, setBinName] = useState("");
  const flatten = (b: MediaBin): MediaBin[] => [
    b,
    ...b.children.flatMap((e) => ("Bin" in e ? flatten(e.Bin) : [])),
  ];
  const bins = snapshot?.project.root ? flatten(snapshot.project.root) : [];
  const bin = bins.find((b) => b.id === binId) ?? bins[0];
  const listed = new Set(
    bin?.children.flatMap((e) => ("Item" in e ? [e.Item] : [])) ?? [],
  );
  const items = Object.values(snapshot?.project.items ?? {}).filter((i) =>
    search
      ? i.name.toLowerCase().includes(search.toLowerCase())
      : listed.has(i.id),
  );
  return (
    <div className="editor-panel-body">
      <div className="editor-search">
        <Search className="h-3.5 w-3.5" />
        <input
          aria-label="Search media"
          placeholder="Search media"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Button
        className="w-full my-2"
        onClick={() => {
          void importFiles().catch(() => {});
        }}
      >
        <FolderOpen className="h-3.5 w-3.5 mr-2" />
        Import Media…
      </Button>
      <select
        className="editor-input w-full mb-2"
        aria-label="Media bin"
        value={bin?.id ?? "0"}
        onChange={(e) => setBinId(e.target.value)}
      >
        {bins.map((b) => (
          <option key={b.id} value={b.id}>
            {b.id === "0" ? "All Project Media" : b.name}
          </option>
        ))}
      </select>
      <form
        className="flex gap-1 mb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void execute("file.newBin", {
            name: binName,
            parent: integer(bin?.id ?? "0"),
          })
            .then(() => setBinName(""))
            .catch(() => {});
        }}
      >
        <input
          className="editor-input min-w-0 w-full"
          aria-label="New bin name"
          placeholder="New bin name"
          value={binName}
          onChange={(e) => setBinName(e.target.value)}
        />
        <Button type="submit" disabled={!binName}>
          Add Bin
        </Button>
      </form>
      {(snapshot?.state.project_selection.length ?? 0) > 0 && (
        <select
          className="editor-input w-full mb-2"
          aria-label="Move selected media to bin"
          value=""
          onChange={(e) => {
            void execute("project.moveToBin", {
              bin: integer(e.target.value),
            }).catch(() => {});
          }}
        >
          <option value="" disabled>
            Move Selected to…
          </option>
          {bins.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
      {!search &&
        bin?.children
          .flatMap((e) => ("Bin" in e ? [e.Bin] : []))
          .map((b) => (
            <button
              className="editor-list-row"
              key={b.id}
              onClick={() => setBinId(b.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const item = e.dataTransfer.getData("application/x-asmr-media");
                if (item)
                  void execute("project.moveToBin", {
                    items: [integer(item)],
                    bin: integer(b.id),
                  }).catch(() => {});
              }}
            >
              <Folder />
              <span>{b.name}</span>
            </button>
          ))}
      {items.length === 0 && (
        <p className="editor-hint mt-3">
          Video, audio and images stay in their original files. Your edits are
          saved in the project.
        </p>
      )}
      {items.map((item) => (
        <div
          key={item.id}
          className="editor-media-row"
          draggable={!item.kind.Sequence}
          onDragStart={(e) =>
            e.dataTransfer.setData("application/x-asmr-media", item.id)
          }
        >
          <button
            className={`editor-list-row min-w-0 flex-1 ${snapshot?.state.project_selection.includes(item.id) ? "bg-fill" : ""}`}
            aria-pressed={snapshot?.state.project_selection.includes(item.id)}
            onClick={(e) => {
              const selected = snapshot?.state.project_selection ?? [];
              const items =
                e.metaKey || e.shiftKey
                  ? selected.includes(item.id)
                    ? selected.filter((id) => id !== item.id)
                    : [...selected, item.id]
                  : [item.id];
              void execute("project.select", { items: items.map(integer) })
                .then(() =>
                  execute(
                    item.kind.Sequence ? "sequence.open" : "source.open",
                    { item: integer(item.id) },
                  ),
                )
                .catch(() => {});
            }}
          >
            {item.kind.Media?.info.audio && !item.kind.Media.info.video ? (
              <Music />
            ) : (
              <Film />
            )}
            <span className="truncate">{item.name}</span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            title={snapshot?.sequence ? "Add at playhead" : "Create sequence"}
            aria-label={`Add ${item.name}`}
            onClick={() => {
              void execute(
                snapshot?.sequence ? "timeline.place" : "file.newSequence",
                snapshot?.sequence
                  ? { item: integer(item.id), track: "V1", audioTrack: "A1" }
                  : { name: item.name, fromItem: integer(item.id) },
              ).catch(() => {});
            }}
          >
            <Plus />
          </Button>
        </div>
      ))}
      <details>
        <summary className="editor-section-title">Media Management</summary>
        <CommandsPanel category="project" />
        <CommandsPanel category="media" />
      </details>
    </div>
  );
}

export function TextPanel({ time }: { time: string }) {
  const { snapshot, execute } = useEditor();
  const [text, setText] = useState("");
  return (
    <div className="editor-panel-body">
      <label className="editor-section-title" htmlFor="editor-title">
        Titles & Captions
      </label>
      <textarea
        id="editor-title"
        className="editor-input w-full min-h-24"
        placeholder="Enter text…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2 mt-2">
        <Button
          disabled={!text || !snapshot?.sequence}
          onClick={() => {
            void execute("graphics.newText", {
              text,
              newClip: true,
              time: integer(time),
            }).catch(() => {});
          }}
        >
          Add Title
        </Button>
        <Button
          disabled={!text || !snapshot?.sequence}
          onClick={() => {
            void execute("captions.add", {
              text,
              time: integer(time),
              durationSeconds: 3,
            }).catch(() => {});
          }}
        >
          Add Caption
        </Button>
      </div>
      {(snapshot?.sequence?.caption_tracks ?? []).map((t) => (
        <section key={t.id}>
          <h3 className="editor-section-title">{t.name}</h3>
          {t.captions.map((c) => (
            <div key={c.id} className="editor-effect">
              <span className="text-caption">{timecode(c.start)}</span>
              <textarea
                className="editor-input w-full"
                aria-label="Caption text"
                key={c.text}
                defaultValue={c.text}
                onBlur={(e) => {
                  if (e.target.value !== c.text)
                    void execute("captions.setText", {
                      caption: integer(c.id),
                      text: e.target.value,
                    }).catch(() => {});
                }}
              />
              <Button
                size="sm"
                onClick={() => {
                  void execute("captions.delete", {
                    captions: [integer(c.id)],
                  }).catch(() => {});
                }}
              >
                Delete
              </Button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function HistoryPanel() {
  const { snapshot, execute } = useEditor();
  return (
    <div className="editor-panel-body">
      <div className="flex gap-2 mb-3">
        <Button
          disabled={!snapshot?.history.undo.length}
          onClick={() => {
            void execute("edit.undo").catch(() => {});
          }}
        >
          Undo
        </Button>
        <Button
          disabled={!snapshot?.history.redo.length}
          onClick={() => {
            void execute("edit.redo").catch(() => {});
          }}
        >
          Redo
        </Button>
      </div>
      {snapshot?.history.undo.map((label, i) => (
        <p className="editor-list-row" key={i}>
          <span className="text-tertiary-foreground w-6">{i + 1}</span>
          {label}
        </p>
      ))}
    </div>
  );
}
