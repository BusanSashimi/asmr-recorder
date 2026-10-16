import {
  lazy,
  Suspense,
  useState,
  useEffect,
  useEffectEvent,
  useCallback,
  useRef,
} from "react";
import { motion } from "motion/react";
import { Toolbar } from "./asmr-recorder/toolbar";
import { Inspector } from "./asmr-recorder/inspector";
import { Preview } from "./asmr-recorder/preview";
import { Timeline } from "./asmr-recorder/timeline";
import { TrimEditor } from "./asmr-recorder/trim-editor";
import { Toaster } from "@/components/ui/toaster";
import {
  RecordingProvider,
  useRecordingContext,
} from "@/contexts/recording-context";
import { toast } from "@/hooks/use-toast";
import { checkForUpdate, applyUpdate } from "@/lib/updater";
import type { Update } from "@/lib/updater";
import { spring } from "@/lib/motion";
import { EditorProvider } from "@/contexts/editor-context";
import { useEditor } from "@/contexts/editor-state";
import { SegmentedControl } from "./ui/segmented-control";
import { Button } from "./ui/button";
import { suspendNativeScreens } from "@/lib/native-screen";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { invoke, isTauri } from "@tauri-apps/api/core";

const EditingWorkspace = lazy(() =>
  import("./editor/workspace").then((module) => ({
    default: module.EditingWorkspace,
  })),
);

function readInspectorOpen(): boolean {
  try {
    const raw = localStorage.getItem("asmr.inspectorOpen");
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

function writeInspectorOpen(value: boolean): void {
  try {
    localStorage.setItem("asmr.inspectorOpen", String(value));
  } catch {
    // ignore
  }
}

function ASMRRecorderContent() {
  const {
    status,
    isExternalRecording,
    isSaving,
    setCaptureActive,
    sectionState,
  } = useRecordingContext();
  const editor = useEditor();
  const { importTake, saveProject } = editor;
  const [closing, setClosing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const switchLock = useRef(false);
  const [mode, setMode] = useState<"recording" | "editing">("recording");
  const [saveFailure, setSaveFailure] = useState<{
    message: string;
    retryable: boolean;
  } | null>(null);
  const [saveProgress, setSaveProgress] = useState("Saving recording…");
  const [handoffPath, setHandoffPath] = useState<string | null>(null);
  const switchMode = useCallback(
    async (next: "recording" | "editing") => {
      if (
        status.isRecording ||
        isExternalRecording ||
        isSaving ||
        switchLock.current
      )
        return;
      switchLock.current = true;
      setSwitching(true);
      try {
        await invoke("editor_transport", { action: "pause", time: null }).catch(
          () => {},
        );
        await suspendNativeScreens(next === "editing").catch((e) =>
          toast({
            title: "Capture device",
            description: String(e),
            variant: "destructive",
          }),
        );
        sectionState.sections.forEach((s) =>
          s.stream?.getTracks().forEach((t) => {
            t.enabled = next === "recording";
          }),
        );
        setCaptureActive(next === "recording");
        setMode(next);
      } finally {
        switchLock.current = false;
        setSwitching(false);
      }
    },
    [
      status.isRecording,
      isExternalRecording,
      isSaving,
      sectionState.sections,
      setCaptureActive,
    ],
  );
  useEffect(() => {
    const saved = (event: Event) => {
      const path = (event as CustomEvent<{ path: string }>).detail.path;
      setSaveFailure(null);
      setHandoffPath(path);
    };
    const failed = (event: Event) =>
      setSaveFailure(
        (event as CustomEvent<{ message: string; retryable: boolean }>).detail,
      );
    const progress = (e: Event) =>
      setSaveProgress((e as CustomEvent<string>).detail);
    window.addEventListener("recordingSaveProgress", progress);
    window.addEventListener("recordingSaved", saved);
    window.addEventListener("recordingSaveFailed", failed);
    return () => {
      window.removeEventListener("recordingSaveProgress", progress);
      window.removeEventListener("recordingSaved", saved);
      window.removeEventListener("recordingSaveFailed", failed);
    };
  }, []);
  useEffect(() => {
    if (!handoffPath || isSaving) return;
    const path = handoffPath;
    setHandoffPath(null);
    void importTake(path)
      .then(() => switchMode("editing"))
      .catch((e) =>
        toast({
          title: "Recording saved; import failed",
          description: `${path}\n${String(e)}`,
          variant: "destructive",
        }),
      );
  }, [handoffPath, isSaving, importTake, switchMode]);

  const finishClose = useCallback(
    async (save: boolean) => {
      try {
        if (save && !(await saveProject())) return;
        await invoke("editor_shutdown");
        await getCurrentWindow().destroy();
      } catch (e) {
        toast({
          title: "Could not close",
          description: String(e),
          variant: "destructive",
        });
      }
    },
    [saveProject],
  );
  const requestClose = useEffectEvent(() => {
    if (
      status.isRecording ||
      isExternalRecording ||
      isSaving ||
      saveFailure?.retryable ||
      editor.snapshot?.voiceover
    ) {
      toast({
        title: "Finish your recording first",
        description: "Stop recording and save the take before closing.",
      });
      return;
    }
    if (editor.snapshot?.jobs.some((j) => !j.finished)) {
      toast({
        title: "An export is running",
        description: "Finish or cancel the job in Export Queue before closing.",
      });
      return;
    }
    if (editor.snapshot?.dirty) setClosing(true);
    else void finishClose(false);
  });
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void Promise.all([
      getCurrentWindow().onCloseRequested((e) => {
        e.preventDefault();
        requestClose();
      }),
      listen("editor-close-requested", requestClose),
    ]).then((fns) => {
      const fn = () => fns.forEach((f) => f());
      if (disposed) fn();
      else cleanup = fn;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  const [inspectorOpen, setInspectorOpen] =
    useState<boolean>(readInspectorOpen);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);

  const toggleInspector = useCallback(() => {
    setInspectorOpen((prev) => {
      const next = !prev;
      writeInspectorOpen(next);
      return next;
    });
  }, []);

  // ⌥⌘I keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.metaKey && e.key === "i") {
        e.preventDefault();
        toggleInspector();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleInspector]);

  // Check for updates once on mount
  useEffect(() => {
    checkForUpdate().then((update) => {
      if (!update) return;
      setPendingUpdate(update);
      toast({
        title: `Update available: v${update.version}`,
        description: "An Update button will appear in the toolbar.",
      });
    });
  }, []);

  const handleApplyUpdate = useCallback(async () => {
    if (!pendingUpdate || status.isRecording || isExternalRecording) return;
    setIsApplyingUpdate(true);
    try {
      await applyUpdate(pendingUpdate, setUpdateProgress);
    } catch (err) {
      toast({
        title: "Update failed",
        description: String(err),
        variant: "destructive",
      });
      setIsApplyingUpdate(false);
    }
  }, [pendingUpdate, status.isRecording, isExternalRecording]);

  const handleCheckUpdate = useCallback(async () => {
    const update = await checkForUpdate();
    if (update) {
      setPendingUpdate(update);
      toast({ title: `Update available: v${update.version}` });
    } else {
      toast({ title: "Up to date", description: "No updates available." });
    }
  }, []);

  return (
    <div className="h-screen flex flex-col bg-background">
      <div className="h-10 shrink-0 flex items-center justify-between px-3 border-b border-separator bg-surface">
        <span className="text-callout font-semibold">ASMR Recorder</span>
        <SegmentedControl
          aria-label="Application mode"
          value={mode}
          onValueChange={(next) => {
            void switchMode(next);
          }}
          disabled={
            status.isRecording ||
            isExternalRecording ||
            isSaving ||
            switching ||
            editor.snapshot?.voiceover
          }
          options={[
            { value: "recording", label: "Recording Mode" },
            { value: "editing", label: "Editing Mode" },
          ]}
        />
      </div>
      {isSaving && (
        <div
          role="status"
          className="px-3 py-1 text-caption bg-surface text-muted-foreground"
        >
          {saveProgress}
        </div>
      )}
      {saveFailure && (
        <div
          role="alert"
          className="flex items-center gap-2 px-3 py-2 text-callout text-destructive bg-surface"
        >
          <span className="flex-1">{saveFailure.message}</span>
          {saveFailure.retryable && (
            <Button
              disabled={isSaving}
              onClick={() =>
                window.dispatchEvent(new Event("retryRecordingSave"))
              }
            >
              Retry Save
            </Button>
          )}
        </div>
      )}
      {mode === "editing" && (
        <Suspense
          fallback={
            <div
              role="status"
              className="flex-1 grid place-items-center text-muted-foreground"
            >
              Opening editor…
            </div>
          }
        >
          <EditingWorkspace />
        </Suspense>
      )}
      <div
        className={
          mode === "recording" ? "flex flex-col flex-1 min-h-0" : "hidden"
        }
        inert={mode !== "recording" || undefined}
      >
        <Toolbar
          inspectorOpen={inspectorOpen}
          onToggleInspector={toggleInspector}
          pendingUpdate={pendingUpdate}
          updateProgress={updateProgress}
          isApplyingUpdate={isApplyingUpdate}
          onApplyUpdate={handleApplyUpdate}
          onOpenMedia={() => {
            void switchMode("editing")
              .then(editor.importFiles)
              .catch((e) =>
                toast({
                  title: "Import failed",
                  description: String(e),
                  variant: "destructive",
                }),
              );
          }}
        />

        {/* Middle row */}
        <div className="flex-1 min-h-0 flex">
          {/* Preview column */}
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <Preview isRecording={status.isRecording} />
          </div>

          {/* Inspector — animated width, content fixed at 264px so it doesn't reflow */}
          <motion.div
            className="shrink-0 border-l border-separator bg-surface overflow-hidden"
            animate={{ width: inspectorOpen ? 264 : 0 }}
            transition={spring.default}
            inert={!inspectorOpen || undefined}
          >
            <Inspector
              pendingUpdate={pendingUpdate}
              onCheckUpdate={handleCheckUpdate}
            />
          </motion.div>
        </div>

        {/* Monitor strip */}
        <div className="h-[--monitor-h] border-t border-separator bg-surface">
          <Timeline
            onOpenEditor={() => {
              void switchMode("editing");
            }}
          />
        </div>
      </div>
      <TrimEditor />
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your project before closing?</DialogTitle>
            <DialogDescription>
              Save a .fcproj file to keep your edits and media references
              together. The recovery journal is also preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setClosing(false)}>Cancel</Button>
            <Button
              onClick={() => {
                void finishClose(false);
              }}
            >
              Close without Saving
            </Button>
            <Button
              variant="accent"
              onClick={() => {
                void finishClose(true);
              }}
            >
              Save Project…
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Toaster />
    </div>
  );
}

export function ASMRRecorder() {
  return (
    <EditorProvider>
      <RecordingProvider>
        <ASMRRecorderContent />
      </RecordingProvider>
    </EditorProvider>
  );
}
