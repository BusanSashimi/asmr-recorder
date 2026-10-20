import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Save, Undo2, Redo2, Upload } from "lucide-react";
import { useEditor } from "@/contexts/editor-state";
import { Button } from "@/components/ui/button";
import { EditorTimeline } from "./timeline";
import { EditorViewer, SourceViewer } from "./viewer";
import { ProgramTransport, type Transport } from "@/lib/editor-transport";
import { EffectInspector, EffectsBrowser } from "./effects";
import { HistoryPanel, MediaBrowser, TextPanel } from "./panels";
import { CommandsPanel } from "./commands";
import type { Command } from "@/types/editor";
import {
  DockviewReact,
  type DockviewApi,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { ExportDialog, JobsPanel } from "./export";
import { TranscriptPanel, NarrationPanel } from "./speech";
import { ScopesPanel } from "./scopes";
import { MasksPanel } from "./masks";
import { MulticamPanel } from "./multicam";
import { MixerPanel } from "./mixer";
import { GraphicsPanel } from "./graphics";
import { InterchangePanel } from "./interchange";
import { ComparisonPanel, TrimPanel } from "./monitor-tools";
import { ProxiesPanel, MarkersPanel } from "./management";
import "./editor.css";

const panels = {
  source: "Source",
  program: "Program",
  timeline: "Timeline",
  media: "Media",
  effects: "Effects",
  inspector: "Inspector",
  color: "Color",
  scopes: "Scopes",
  mixer: "Audio Mixer",
  text: "Titles & Captions",
  history: "History",
  actions: "All Actions",
  multicam: "Multicam",
  masks: "Masks",
  transcript: "Transcript",
  narration: "Narration",
  proxies: "Proxies",
  export: "Export Queue",
  graphics: "Graphics",
  markers: "Markers",
  comparison: "Comparison",
  trim: "Trim",
  interchange: "Interchange",
};
type Panel = keyof typeof panels;
const workspaces = ["Assembly", "Editing", "Color", "Effects", "Audio"];
const DockContext = createContext<{
  time: string;
  seek: ProgramTransport["seek"];
  transport: ProgramTransport;
} | null>(null);
function DockPanel({ api }: IDockviewPanelProps) {
  const ctx = useContext(DockContext)!;
  const p = api.id as Panel;
  switch (p) {
    case "program":
      return (
        <EditorViewer
          time={ctx.time}
          programTransport={ctx.transport}
        />
      );
    case "source":
      return <SourceViewer />;
    case "timeline":
      return <EditorTimeline time={ctx.time} onSeek={ctx.seek} />;
    case "media":
      return <MediaBrowser />;
    case "effects":
      return <EffectsBrowser />;
    case "inspector":
      return <EffectInspector time={ctx.time} />;
    case "color":
      return <EffectInspector time={ctx.time} colorOnly />;
    case "multicam":
      return <MulticamPanel time={ctx.time} />;
    case "masks":
      return <MasksPanel time={ctx.time} />;
    case "scopes":
      return <ScopesPanel time={ctx.time} />;
    case "transcript":
      return <TranscriptPanel onSeek={ctx.seek} />;
    case "narration":
      return <NarrationPanel time={ctx.time} />;
    case "mixer":
      return <MixerPanel />;
    case "text":
      return <TextPanel time={ctx.time} />;
    case "history":
      return <HistoryPanel />;
    case "actions":
      return <CommandsPanel />;
    case "export":
      return <JobsPanel />;
    case "graphics":
      return <GraphicsPanel time={ctx.time} />;
    case "interchange":
      return <InterchangePanel />;
    case "comparison":
      return <ComparisonPanel time={ctx.time} />;
    case "trim":
      return <TrimPanel />;
    case "proxies":
      return <ProxiesPanel />;
    case "markers":
      return <MarkersPanel time={ctx.time} onSeek={ctx.seek} />;
    default:
      return <CommandsPanel category={p} />;
  }
}
const dockComponents = { panel: DockPanel };
function preset(api: DockviewApi, name: string) {
  api.clear();
  api.addPanel({ id: "program", title: panels.program, component: "panel" });
  api.addPanel({
    id: "source",
    title: "Source",
    component: "panel",
    position: { referencePanel: "program", direction: "within" },
    inactive: true,
  });
  api.addPanel({
    id: "timeline",
    title: panels.timeline,
    component: "panel",
    position: { referencePanel: "program", direction: "below" },
    initialHeight: window.innerHeight < 650 ? 170 : 240,
  });
  const left: Panel =
    name === "Effects" || name === "Color" ? "effects" : "media";
  const right: Panel =
    name === "Audio"
      ? "mixer"
      : name === "Color"
        ? "color"
        : name === "Assembly"
          ? "history"
          : "inspector";
  api.addPanel({
    id: right,
    title: panels[right],
    component: "panel",
    position: { referencePanel: "program", direction: "right" },
    initialWidth: 264,
  });
  api.addPanel({
    id: left,
    title: panels[left],
    component: "panel",
    position: {
      referencePanel: window.innerWidth < 1050 ? right : "program",
      direction: window.innerWidth < 1050 ? "within" : "left",
    },
    initialWidth: 240,
    inactive: window.innerWidth < 1050,
  });
  if (name === "Color")
    api.addPanel({
      id: "scopes",
      title: "Scopes",
      component: "panel",
      position: { referencePanel: "timeline", direction: "within" },
      inactive: true,
    });
  api.getPanel("program")?.api.setActive();
}

export function EditingWorkspace() {
  const {
    snapshot,
    error,
    busy,
    refresh,
    execute,
    importFiles,
    saveProject,
    openProject,
  } = useEditor();
  const [workspace, setWorkspace] = useState("Editing");
  const workspaceRef = useRef("Editing");
  const dock = useRef<DockviewApi | null>(null);
  const layoutSubscription = useRef<{ dispose: () => void } | null>(null);
  const trimInput = useRef<HTMLInputElement>(null);
  const sequenceId = snapshot?.state.active_sequence;
  const transport = useMemo(
    () => new ProgramTransport((action, time) =>
      invoke<Transport>("editor_transport", { action, time: time ?? null }),
    ),
    // A project/sequence change invalidates queued seeks and responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot?.path, sequenceId],
  );
  useEffect(() => () => transport.cancel(), [transport]);
  const program = useSyncExternalStore(transport.subscribe, transport.getSnapshot);
  const time = program.time ?? (sequenceId
    ? (snapshot?.state.playheads[sequenceId] ?? "0")
    : "0");
  const seek = transport.seek;
  const [exportOpen, setExportOpen] = useState(false);
  const report = (p: Promise<unknown>) => {
    void p.catch(() => {});
  };
  useEffect(() => () => layoutSubscription.current?.dispose(), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        (e.target instanceof HTMLElement &&
          e.target.closest(
            'input,textarea,select,[contenteditable="true"],[role="dialog"]',
          ))
      )
        return;
      const source = dock.current?.activePanel?.id === "source";
      const trim = dock.current?.activePanel?.id === "trim";
      if (e.code === "Space") {
        e.preventDefault();
        if (trim) {
          report(execute("trim.playAround", { toggle: true }));
          return;
        }
        if (!source) {
          void transport.run("toggle");
          return;
        }
        void invoke<Transport>("editor_transport", {
          action: "status",
          time: null,
        })
          .then((s) =>
            invoke("editor_transport", {
              action: s.playing ? "pause" : source ? "sourcePlay" : "play",
            }),
          )
          .catch(() => {});
        return;
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const key = /^Key[A-Z]$/.test(e.code)
          ? e.code.slice(3).toLowerCase()
          : e.key.toLowerCase();
        if (["j", "k", "l"].includes(key)) {
          e.preventDefault();
          if (trim) {
            if (!e.repeat)
              report(
                execute(
                  key === "k" ? "trim.shuttleStop" : "trim.shuttle",
                  key === "k"
                    ? {}
                    : {
                        direction: key === "j" ? "reverse" : "forward",
                        slow: e.shiftKey,
                      },
                ),
              );
            return;
          }
          if (!e.repeat && !source)
            void transport.run(
              key === "k" ? "pause" : key === "j" ? "reverse" : "forward",
            );
          else if (!e.repeat)
            void invoke("editor_transport", {
              action:
                key === "k"
                  ? "pause"
                  : source
                    ? key === "j"
                      ? "sourceReverse"
                      : "sourceForward"
                    : key === "j"
                      ? "reverse"
                      : "forward",
            }).catch(() => {});
          return;
        }
        if (["i", "o", "m"].includes(key)) {
          e.preventDefault();
          report(
            execute(
              key === "i"
                ? "markers.markIn"
                : key === "o"
                  ? "markers.markOut"
                  : "markers.add",
              { target: source ? "source" : "program" },
            ),
          );
          return;
        }
        const tool = (
          {
            v: "select",
            c: "razor",
            b: "ripple",
            n: "roll",
            y: "slip",
            u: "slide",
            r: "rate",
          } as Record<string, string>
        )[key];
        if (tool) {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("editor-tool", { detail: tool }),
          );
          return;
        }
      }
      if (e.metaKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        report(saveProject(e.shiftKey));
        return;
      }
      const command = snapshot?.commands.find(
        (c) => c.shortcut && matchesShortcut(e, c),
      );
      if (command?.enabled && command.params === "{}") {
        e.preventDefault();
        report(execute(command.id));
      }
      if (e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        report(execute("sequence.addEdit"));
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        report(execute(e.shiftKey ? "edit.rippleDelete" : "edit.clear"));
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [snapshot?.commands, execute, saveProject, transport]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!busy) await refresh();
      if (!cancelled)
        timer = setTimeout(() => {
          void poll();
        }, 2000);
    };
    timer = setTimeout(() => {
      void poll();
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [busy, refresh]);
  async function safeOpen() {
    if (
      snapshot?.dirty &&
      !(await ask(
        "Open another project? Unsaved edits remain in recovery, but save first to keep a named copy.",
        { title: "Unsaved Project", kind: "warning" },
      ))
    )
      return;
    await transport.run("pause");
    transport.cancel();
    await openProject();
  }
  function selectWorkspace(name: string, reset = false) {
    const api = dock.current;
    if (!api) return;
    workspaceRef.current = name;
    setWorkspace(name);
    const key = `asmr.editorDock.v1.${name}`;
    if (!reset) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          api.fromJSON(JSON.parse(stored));
          return;
        }
      } catch {
        /* reset a layout from an older app */
      }
    }
    preset(api, name);
  }
  const showPanel = useCallback((id: Panel) => {
    const api = dock.current;
    if (!api) return;
    const existing = api.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }
    const anchor = api.getPanel("inspector") ?? api.activePanel;
    api.addPanel({
      id,
      title: panels[id],
      component: "panel",
      position: anchor
        ? { referencePanel: anchor, direction: "within" }
        : undefined,
    });
  }, []);
  useEffect(() => {
    if (snapshot?.source?.item) showPanel("source");
  }, [snapshot?.source?.item, showPanel]);
  function movePanel(position: string) {
    const api = dock.current;
    const panel = api?.activePanel;
    if (!api || !panel) return;
    if (position === "float") {
      api.addFloatingGroup(panel, { width: 400, height: 320 });
      return;
    }
    if (position === "maximize") {
      if (panel.api.isMaximized()) panel.api.exitMaximized();
      else panel.api.maximize();
      return;
    }
    const target =
      api.panels.find((p) => p.id !== panel.id && p.id === "program") ??
      api.panels.find((p) => p.id !== panel.id);
    panel.api.moveTo({
      group: target?.group,
      position: position as "left" | "right" | "bottom" | "center",
    });
  }
  return (
    <div className="editor-workspace">
      <div className="editor-panel-toolbar shrink-0">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open project"
          title="Open Project"
          onClick={() => report(safeOpen())}
        >
          <FolderOpen />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Save project"
          title="Save Project (⌘S)"
          onClick={() => report(saveProject())}
        >
          <Save />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Undo"
          title="Undo (⌘Z)"
          disabled={!snapshot?.history.undo.length}
          onClick={() => report(execute("edit.undo"))}
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Redo"
          title="Redo (⇧⌘Z)"
          disabled={!snapshot?.history.redo.length}
          onClick={() => report(execute("edit.redo"))}
        >
          <Redo2 />
        </Button>
        <span className="text-callout truncate min-w-0 flex-1">
          {snapshot?.project.name ?? "Loading editor…"}
          {snapshot?.dirty ? " •" : ""}
        </span>
        <select
          className="editor-input editor-workspace-picker"
          aria-label="Editing workspace"
          value={workspace}
          onChange={(e) => selectWorkspace(e.target.value)}
        >
          {workspaces.map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        <select
          className="editor-input"
          aria-label="Show panel"
          value=""
          onChange={(e) => showPanel(e.target.value as Panel)}
        >
          <option value="" disabled>
            Panels
          </option>
          {Object.entries(panels).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          className="editor-input"
          aria-label="Move active panel"
          value=""
          onChange={(e) => movePanel(e.target.value)}
        >
          <option value="" disabled>
            Arrange
          </option>
          <option value="left">Dock Left</option>
          <option value="right">Dock Right</option>
          <option value="bottom">Dock Below</option>
          <option value="center">Group as Tab</option>
          <option value="float">Float Panel</option>
          <option value="maximize">Maximize / Restore</option>
        </select>
        <input
          ref={trimInput}
          type="file"
          accept="video/*"
          className="hidden"
          aria-label="Choose video for lossless trim"
          onChange={(e) => {
            const blob = e.target.files?.[0];
            if (blob)
              window.dispatchEvent(
                new CustomEvent("recordingReadyForEdit", { detail: { blob } }),
              );
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          title="Trim a recording without re-encoding"
          onClick={() => trimInput.current?.click()}
        >
          Quick Trim
        </Button>
        <Button
          variant="accent"
          disabled={!snapshot?.sequence}
          onClick={() => {
            showPanel("export");
            setExportOpen(true);
          }}
        >
          <Upload className="w-3.5 h-3.5 mr-1" />
          Export
        </Button>
      </div>
      {error && (
        <div role="alert" className="editor-error">
          {error}
          <button onClick={() => report(refresh())}>Retry</button>
        </div>
      )}
      {!!snapshot?.recovery.length && (
        <div className="editor-recovery">
          An unsaved project can be recovered.
          <Button
            size="sm"
            onClick={() =>
              report(execute("file.recover", { id: snapshot.recovery[0].id }))
            }
          >
            Recover
          </Button>
        </div>
      )}
      <DockContext.Provider value={{ time, seek, transport }}>
        <div className="editor-dock-area">
          <DockviewReact
            components={dockComponents}
            theme={{ name: "asmr", className: "dockview-theme-asmr" }}
            onReady={({ api }) => {
              dock.current = api;
              selectWorkspace(workspaceRef.current);
              layoutSubscription.current = api.onDidLayoutChange(() => {
                try {
                  localStorage.setItem(
                    `asmr.editorDock.v1.${workspaceRef.current}`,
                    JSON.stringify(api.toJSON()),
                  );
                } catch {
                  /* layout persistence is optional */
                }
              });
            }}
          />
        </div>
      </DockContext.Provider>
      {!snapshot?.sequence && (
        <div className="flex justify-center gap-2 p-2">
          <Button onClick={() => report(importFiles())}>Import Media…</Button>
          <Button
            onClick={() =>
              report(execute("file.newSequence", { name: "Edit", fps: 30 }))
            }
          >
            New Sequence
          </Button>
        </div>
      )}
      <div className="editor-status">
        <span>
          {busy
            ? "Applying edit…"
            : snapshot?.dirty
              ? "Unsaved changes · recovery enabled"
              : "Ready"}
        </span>
        <button onClick={() => selectWorkspace(workspace, true)}>
          Reset Workspace
        </button>
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
    </div>
  );
}

function matchesShortcut(e: KeyboardEvent, c: Command) {
  const keys = c.shortcut?.split("+") ?? [];
  const last = keys[keys.length - 1]?.toLowerCase();
  return (
    e.metaKey === keys.includes("Cmd") &&
    e.shiftKey === keys.includes("Shift") &&
    e.altKey === keys.includes("Alt") &&
    !e.ctrlKey &&
    e.key.toLowerCase() === last
  );
}
