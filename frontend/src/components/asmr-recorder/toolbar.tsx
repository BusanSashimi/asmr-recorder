import { useRef, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Mic,
  FolderOpen,
  FolderSearch,
  Square,
  Circle,
  Volume2,
  Video,
  ArrowDownCircle,
  PanelRight,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRecordingContext } from "@/contexts/recording-context";
import { formatDuration } from "@/types/recording";
import { StereoMeter } from "./audio-monitor-graphics";
import { spring } from "@/lib/motion";
import type { Update } from "@/lib/updater";

interface ToolbarProps {
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  pendingUpdate: Update | null;
  updateProgress: number;
  isApplyingUpdate: boolean;
  onApplyUpdate: () => void;
  onOpenMedia?: () => void;
}

export function Toolbar({
  inspectorOpen,
  onToggleInspector,
  pendingUpdate,
  updateProgress,
  isApplyingUpdate,
  onApplyUpdate,
  onOpenMedia,
}: ToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    status,
    sectionState,
    externalConfig,
    recordingAnalysers,
    isExternalRecording,
    startExternalRecording,
    stopExternalRecording,
    isSaving,
  } = useRecordingContext();

  const isRecording = status.isRecording || isExternalRecording;

  // Track output path changes to show save confirmation toast
  const previousOutputPathRef = useRef(status.outputPath);
  useEffect(() => {
    if (
      status.outputPath &&
      status.outputPath !== previousOutputPathRef.current
    ) {
      const savedPath = status.outputPath;
      toast({
        title: "Recording saved",
        description: savedPath,
        action: (
          <ToastAction
            altText="Reveal in Finder"
            onClick={() => revealItemInDir(savedPath).catch(() => {})}
          >
            Reveal in Finder
          </ToastAction>
        ),
      });
    }
    previousOutputPathRef.current = status.outputPath;
  }, [status.outputPath]);

  const handleOpenFile = () => onOpenMedia ? onOpenMedia() : fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    window.dispatchEvent(
      new CustomEvent("recordingReadyForEdit", { detail: { blob: file } }),
    );
    e.target.value = "";
  };

  const handleRecord = async () => {
    try {
      if (isRecording) {
        await stopExternalRecording();
        toast({
          title: "Recording stopped",
          description: "Saving recording...",
        });
      } else {
        await startExternalRecording();
        toast({
          title: "Recording started",
          description: "Recording preview layout...",
        });
      }
    } catch (err) {
      toast({
        title: "Recording failed",
        description: String(err),
        variant: "destructive",
      });
    }
  };

  const handleShowInFinder = () => {
    const path = status.outputPath;
    if (path) {
      revealItemInDir(path).catch(() =>
        toast({
          title: "Couldn't reveal file",
          description: path,
          variant: "destructive",
        }),
      );
    } else {
      toast({
        title: "No recording",
        description: "Record something first",
      });
    }
  };

  const hasContent = sectionState.sections.some((s) => s.source !== null);

  const activeSectionCount = sectionState.sections.filter(
    (s) => s.source !== null,
  ).length;

  return (
    <div className="h-[--toolbar-h] border-b border-separator bg-surface px-3 flex items-center gap-2 shrink-0">
      {/* 1. Record / Stop hero button */}
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span so the tooltip still fires on a disabled button */}
          <span className="inline-flex">
            <Button
              variant="record"
              size="default"
              className="rounded-full gap-1.5 tabular-nums"
              onClick={handleRecord}
              disabled={!hasContent || isSaving}
              aria-label={
                !hasContent
                  ? "Add a source to start recording"
                  : isRecording
                  ? "Stop recording"
                  : "Start recording"
              }
            >
              {isRecording ? (
                <>
                  <Square className="h-3.5 w-3.5 fill-current shrink-0" />
                  Stop
                  <span className="tabular-nums">
                    {formatDuration(status.durationMs)}
                  </span>
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-white/80 animate-pulse shrink-0"
                    aria-hidden="true"
                  />
                </>
              ) : (
                <>
                  <Circle className="h-3.5 w-3.5 fill-current shrink-0" />
                  {isSaving ? "Saving…" : "Record"}
                </>
              )}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {!hasContent
            ? "Add a source to start recording"
            : isRecording
            ? "Stop recording"
            : "Start recording"}
        </TooltipContent>
      </Tooltip>

      {/* 2. Status chips + recording meters */}
      <div className="flex items-center gap-1">
        <AnimatePresence>
          {activeSectionCount > 0 && (
            <motion.div
              key="sections-chip"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={spring.snappy}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1 h-6 px-1.5 rounded-md bg-fill text-caption text-muted-foreground">
                    <Video className="h-3 w-3" />
                    <span>{activeSectionCount}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {activeSectionCount} section
                  {activeSectionCount !== 1 ? "s" : ""} active
                </TooltipContent>
              </Tooltip>
            </motion.div>
          )}

          {externalConfig.captureMic && (
            <motion.div
              key="mic-chip"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={spring.snappy}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center h-6 px-1.5 rounded-md bg-fill text-caption text-muted-foreground">
                    <Mic className="h-3 w-3" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>Microphone enabled</TooltipContent>
              </Tooltip>
            </motion.div>
          )}

          {externalConfig.captureSystemAudio && (
            <motion.div
              key="sys-chip"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={spring.snappy}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center h-6 px-1.5 rounded-md bg-fill text-caption text-muted-foreground">
                    <Volume2 className="h-3 w-3" />
                  </div>
                </TooltipTrigger>
                <TooltipContent>System audio enabled</TooltipContent>
              </Tooltip>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Per-source meters while recording */}
        {isRecording && recordingAnalysers.mic && (
          <StereoMeter
            analyserL={recordingAnalysers.mic}
            analyserR={recordingAnalysers.mic}
            className="rounded"
          />
        )}
        {isRecording && recordingAnalysers.sys && (
          <StereoMeter
            analyserL={recordingAnalysers.sys}
            analyserR={recordingAnalysers.sys}
            className="rounded"
          />
        )}
      </div>

      {/* 3. Flex spacer */}
      <div className="flex-1" />

      {/* 4. File actions */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={handleOpenFile}
            aria-label="Open recording file"
          >
            <FolderOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Open…</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open a saved recording for editing</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={handleShowInFinder}
            aria-label="Show recording in Finder"
          >
            <FolderSearch className="h-4 w-4" />
            <span className="hidden sm:inline">Show in Finder</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reveal saved file in Finder</TooltipContent>
      </Tooltip>

      {/* 5. Update */}
      {pendingUpdate && !isApplyingUpdate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-warning hover:text-warning"
              onClick={onApplyUpdate}
              disabled={isRecording}
              aria-label={`Update to v${pendingUpdate.version}`}
            >
              <ArrowDownCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Update</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Update to v{pendingUpdate.version} — will relaunch
          </TooltipContent>
        </Tooltip>
      )}
      {isApplyingUpdate && (
        <span className="text-caption text-muted-foreground tabular-nums">
          {Math.round(updateProgress * 100)}%
        </span>
      )}

      {/* 6. Inspector toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={inspectorOpen ? "bg-fill" : ""}
            onClick={onToggleInspector}
            aria-label="Show/Hide Inspector"
            aria-pressed={inspectorOpen}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {inspectorOpen ? "Hide Inspector" : "Show Inspector"} (⌥⌘I)
        </TooltipContent>
      </Tooltip>

      {/* Hidden file input for opening saved recordings */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,.mp4"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
