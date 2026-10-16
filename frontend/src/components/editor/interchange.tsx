import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useEditor } from "@/contexts/editor-state";
import { Button } from "@/components/ui/button";
import { CommandDialog } from "./commands";
import type { Command } from "@/types/editor";

export function InterchangePanel() {
  const { snapshot, execute } = useEditor();
  const [format, setFormat] = useState("xml"),
    [status, setStatus] = useState("");
  const [active, setActive] = useState<Command | null>(null);
  const formats = {
    xml: "Final Cut Pro 7 XML",
    fcpxml: "Final Cut Pro XML",
    otio: "OpenTimelineIO",
    edl: "CMX EDL",
    aaf: "AAF",
    omf: "OMF",
  };
  async function exportSequence() {
    try {
      const path = await save({
        title: "Export Sequence",
        defaultPath: `${snapshot?.project.name ?? "Sequence"}.${format}`,
      });
      if (!path) return;
      const result = (await execute("file.exportInterchange", {
        format,
        path,
      })) as { warnings?: string[] };
      setStatus(
        `Exported to ${path}${result?.warnings?.length ? `\n${result.warnings.join("\n")}` : ""}`,
      );
    } catch (e) {
      setStatus(String(e));
    }
  }
  async function importSequence() {
    try {
      const path = await open({
        title: "Import Sequence",
        filters: [
          {
            name: "Editing Sequences",
            extensions: ["xml", "fcpxml", "edl", "otio", "aaf", "omf"],
          },
        ],
      });
      if (typeof path === "string") {
        await execute("file.import", { paths: [path] });
        setStatus("Sequence imported. Open it in the Media panel.");
      }
    } catch (e) {
      setStatus(String(e));
    }
  }
  return (
    <div className="editor-panel-body">
      <p className="editor-hint mb-3">
        Exchange a sequence with another editing application. Format limits can
        affect effects, titles, and transitions.
      </p>
      <Button
        className="w-full mb-3"
        onClick={() => {
          void importSequence();
        }}
      >
        Import Sequence…
      </Button>
      <label className="text-caption">
        Export Format
        <select
          className="editor-input w-full my-1"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          {Object.entries(formats).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Button
        className="w-full my-2"
        disabled={!snapshot?.sequence}
        onClick={() => {
          void exportSequence();
        }}
      >
        Export Sequence…
      </Button>
      <p role="status" className="editor-hint whitespace-pre-wrap break-all">
        {status}
      </p>
      <details>
        <summary className="editor-section-title">AAF & OMF Options</summary>
        {snapshot?.commands
          .filter((c) => ["file.exportAaf", "file.exportOmf"].includes(c.id))
          .map((c) => (
            <button
              key={c.id}
              className="editor-list-row"
              disabled={!c.enabled}
              onClick={() => setActive(c)}
            >
              {c.label}
            </button>
          ))}
      </details>
      {active && (
        <CommandDialog command={active} onClose={() => setActive(null)} />
      )}
    </div>
  );
}
