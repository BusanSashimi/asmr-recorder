import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useEditor } from "@/contexts/editor-state";
import { integer } from "@/lib/editor-time";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CommandsPanel } from "./commands";
interface Format {
  id: string;
  label: string;
  extension: string;
  available: boolean;
  imageSequence: boolean;
}
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { snapshot, execute, query, busy } = useEditor();
  const [formats, setFormats] = useState<Format[]>([]);
  const [format, setFormat] = useState("h264");
  const [range, setRange] = useState("entire");
  const [bitrate, setBitrate] = useState("12000");
  const [captions, setCaptions] = useState(false);
  const [queue, setQueue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void query("export.formats")
      .then((v) => setFormats(v as Format[]))
      .catch((e) => setError(String(e)));
  }, [query]);
  const selected = formats.find((f) => f.id === format);
  async function exportFile() {
    if (!selected) return;
    const path = await save({
      title: selected.imageSequence
        ? "Choose Image Sequence Base Name"
        : "Export Media",
      defaultPath: `${snapshot?.project.name ?? "Edit"}.${selected.extension}`,
      filters: [{ name: selected.label, extensions: [selected.extension] }],
    });
    if (!path) return;
    try {
      await execute("export.queue.add", {
        path,
        format,
        range,
        bitrateKbps: Number(bitrate),
        burnCaptions: captions,
        hardwareEncoding: "auto",
        start: !queue,
        wait: false,
      });
      onClose();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export Media</DialogTitle>
          <DialogDescription>
            Render a copy of your sequence. Track progress in the Export Queue
            panel.
          </DialogDescription>
        </DialogHeader>
        <label className="text-callout">
          Format
          <select
            className="editor-input w-full mt-1"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            {formats.map((f) => (
              <option key={f.id} value={f.id} disabled={!f.available}>
                {f.label}
                {f.available ? "" : " · Unavailable on this device"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-callout">
          Range
          <select
            className="editor-input w-full mt-1"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="entire">Entire Sequence</option>
            <option value="inOut">In to Out</option>
            <option value="workArea">Work Area</option>
          </select>
        </label>
        <label className="text-callout">
          Video Bitrate (kbps)
          <input
            type="number"
            min="1"
            max="1000000"
            className="editor-input w-full mt-1"
            value={bitrate}
            onChange={(e) => setBitrate(e.target.value)}
          />
        </label>
        <label className="text-callout flex gap-2">
          <input
            type="checkbox"
            checked={captions}
            onChange={(e) => setCaptions(e.target.checked)}
          />
          Burn Captions into Video
        </label>
        <label className="text-callout flex gap-2">
          <input
            type="checkbox"
            checked={queue}
            onChange={(e) => setQueue(e.target.checked)}
          />
          Add to Queue without Starting
        </label>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="accent"
            disabled={busy || !selected?.available || !(Number(bitrate) > 0)}
            onClick={() => {
              void exportFile().catch((e) => setError(String(e)));
            }}
          >
            Choose Location…
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
interface QueueItem {
  id: string;
  path: string;
  status: string;
  error: string | null;
  progress?: number;
}
export function JobsPanel() {
  const { snapshot, execute, query } = useEditor();
  const [queue, setQueue] = useState<{ running: boolean; items: QueueItem[] }>({
    running: false,
    items: [],
  });
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const v = await query("export.queue.list");
        if (!cancelled) setQueue(v as typeof queue);
      } catch {
        /* context reports error */
      }
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  const run = (id: string, params = {}) => {
    void execute(id, params).catch(() => {});
  };
  return (
    <div className="editor-panel-body">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!queue.items.length}
          onClick={() =>
            run(queue.running ? "export.queue.stop" : "export.queue.start")
          }
        >
          {queue.running ? "Pause Queue" : "Start Queue"}
        </Button>
        <Button onClick={() => run("export.queue.clear")}>
          Clear Finished
        </Button>
      </div>
      {!queue.items.length && (
        <p className="editor-hint my-3">
          Exports appear here after you choose an output location.
        </p>
      )}
      {queue.items.map((q, i) => (
        <section key={q.id} className="editor-effect">
          <h3 className="editor-section-title truncate" title={q.path}>
            {q.path.split(/[\\/]/).pop()}
          </h3>
          <p className="text-caption">{q.status}</p>
          {q.error && (
            <p role="alert" className="editor-error">
              {q.error}
            </p>
          )}
          <div className="flex flex-wrap gap-1 mt-2">
            <Button
              size="sm"
              onClick={() => run("export.queue.cancel", { id: integer(q.id) })}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() =>
                run("export.queue.retry", { id: integer(q.id), start: true })
              }
            >
              Retry
            </Button>
            <Button
              size="sm"
              disabled={i === 0}
              onClick={() =>
                run("export.queue.move", { id: integer(q.id), by: -1 })
              }
            >
              Move Up
            </Button>
            <Button
              size="sm"
              onClick={() => run("export.queue.remove", { id: integer(q.id) })}
            >
              Remove
            </Button>
          </div>
        </section>
      ))}
      {snapshot?.jobs.map((j) => (
        <section key={j.id} className="editor-effect">
          <h3 className="editor-section-title">{j.label}</h3>
          <progress
            className="w-full accent-accent"
            max={1}
            value={Number(j.progress)}
          />
          <p className="editor-hint">
            {j.status} · {Math.round(Number(j.progress) * 100)}%
            {j.etaSeconds != null
              ? ` · ${Math.ceil(Number(j.etaSeconds))}s remaining`
              : ""}
          </p>
          {!j.finished && (
            <Button
              size="sm"
              onClick={() => run("jobs.cancel", { job: integer(j.id) })}
            >
              Cancel Job
            </Button>
          )}
          {j.result != null && (
            <p className="text-caption break-all">
              {typeof j.result === "string"
                ? j.result
                : ((j.result as { error?: string }).error ??
                  ((j.result as { path?: string }).path
                    ? `Saved ${(j.result as { path: string }).path.split(/[\\/]/).pop()}`
                    : "Completed"))}
            </p>
          )}
        </section>
      ))}
      <details className="mt-3">
        <summary className="editor-section-title">
          Presets & Advanced Export
        </summary>
        <CommandsPanel category="export" />
      </details>
    </div>
  );
}
