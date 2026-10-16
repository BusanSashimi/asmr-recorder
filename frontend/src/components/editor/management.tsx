import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useEditor } from "@/contexts/editor-state";
import { Button } from "@/components/ui/button";
import { integer, timecode } from "@/lib/editor-time";
import { CommandsPanel } from "./commands";

export function ProxiesPanel() {
  const { snapshot, execute } = useEditor();
  const [preset, setPreset] = useState("prores_proxy_quarter");
  const selected = snapshot?.state.project_selection ?? [];
  const run = (id: string, params = {}) => {
    void execute(id, params).catch(() => {});
  };
  return (
    <div className="editor-panel-body">
      <p className="editor-hint mb-3">
        Select media in the Media panel. Proxies improve editing performance;
        export uses original media.
      </p>
      <label className="text-caption">
        Proxy Format
        <select
          className="editor-input w-full mt-1"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
        >
          <option value="prores_proxy_quarter">
            ProRes Proxy · Quarter Size
          </option>
          <option value="prores_proxy_half">ProRes Proxy · Half Size</option>
          <option value="h264_quarter">H.264 · Quarter Size</option>
          <option value="h264_half">H.264 · Half Size</option>
        </select>
      </label>
      <Button
        className="my-2 w-full"
        disabled={!selected.length}
        onClick={() =>
          run("media.createProxies", { preset, attach: true, wait: false })
        }
      >
        Create Proxies
      </Button>
      <div className="flex gap-2">
        <Button onClick={() => run("media.toggleProxies")}>
          Toggle Proxies
        </Button>
        <Button
          disabled={!selected.length}
          onClick={() => run("media.detachProxies")}
        >
          Detach
        </Button>
      </div>
      {selected.map((id) => (
        <section className="editor-effect" key={id}>
          <h3 className="editor-section-title">
            {snapshot?.project.items[id]?.name}
          </h3>
          <p className="editor-hint break-all">
            {snapshot?.project.items[id]?.kind.Media?.proxy?.File?.path ??
              "No proxy attached"}
          </p>
          <Button
            size="sm"
            onClick={() => {
              void open({ title: "Attach Proxy" }).then((path) => {
                if (path)
                  run("media.attachProxies", { item: integer(id), path });
              });
            }}
          >
            Attach File…
          </Button>
        </section>
      ))}
      <details>
        <summary className="editor-section-title">Reconnect & Ingest</summary>
        <CommandsPanel category="media" />
      </details>
    </div>
  );
}

export function MarkersPanel({
  time,
  onSeek,
}: {
  time: string;
  onSeek: (time: string) => void;
}) {
  const { snapshot, execute } = useEditor();
  const [name, setName] = useState("");
  const run = (id: string, params = {}) => {
    void execute(id, params).catch(() => {});
  };
  return (
    <div className="editor-panel-body">
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          run("markers.add", { target: "program", time: integer(time), name });
          setName("");
        }}
      >
        <input
          className="editor-input w-full min-w-0"
          aria-label="Marker name"
          placeholder="Marker name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={!snapshot?.sequence}>
          Add
        </Button>
      </form>
      {snapshot?.sequence?.markers.map((m) => (
        <section className="editor-effect" key={m.id}>
          <button
            className="editor-list-row text-accent"
            onClick={() => onSeek(m.start)}
          >
            {timecode(m.start, snapshot.sequence!.settings.frame_rate)} ·{" "}
            {m.name || "Marker"}
          </button>
          <input
            className="editor-input w-full"
            aria-label="Rename marker"
            key={m.name}
            defaultValue={m.name}
            onBlur={(e) => {
              if (e.target.value !== m.name)
                run("markers.edit", {
                  marker: integer(m.id),
                  name: e.target.value,
                });
            }}
          />
        </section>
      ))}
      <details>
        <summary className="editor-section-title">Marker Tools</summary>
        <CommandsPanel category="markers" />
      </details>
    </div>
  );
}
