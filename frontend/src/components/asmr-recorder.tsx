import { useState, useEffect, useCallback } from "react";
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
  const { status, isExternalRecording } = useRecordingContext();

  const [inspectorOpen, setInspectorOpen] = useState<boolean>(readInspectorOpen);
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
      <Toolbar
        inspectorOpen={inspectorOpen}
        onToggleInspector={toggleInspector}
        pendingUpdate={pendingUpdate}
        updateProgress={updateProgress}
        isApplyingUpdate={isApplyingUpdate}
        onApplyUpdate={handleApplyUpdate}
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
        <Timeline />
      </div>

      <TrimEditor />
      <Toaster />
    </div>
  );
}

export function ASMRRecorder() {
  return (
    <RecordingProvider>
      <ASMRRecorderContent />
    </RecordingProvider>
  );
}
