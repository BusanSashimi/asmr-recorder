import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Mic,
  Download,
  Square,
  Circle,
  Settings,
  Video,
  Volume2,
  VolumeX,
  FolderOpen,
  RotateCcw,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useRecordingContext } from "@/contexts/recording-context";
import { formatDuration, OUTPUT_RESOLUTIONS } from "@/types/recording";
import type { VideoQuality, OutputResolution, LayoutType, PipPosition } from "@/types/recording";
import { LAYOUT_LABELS } from "@/lib/layouts";
import { gainToDb } from "@/lib/gain-to-db";
import { StereoMeter } from "./audio-monitor-graphics";
import { checkForUpdate, applyUpdate } from "@/lib/updater";
import type { Update } from "@/lib/updater";
import { BuildSoundsDialog } from "./build-sounds-dialog";
import { useBuildSounds } from "@/contexts/build-sound-context";
import {
  dispatchRecordingReadyForEdit,
  type EditableMedia,
  type RecordingReadyForEditDetail,
} from "@/types/editable-media";

interface AudioApp {
  bundleId: string;
  name: string;
  pid: number;
}

// Sentinel for the "entire system" Select option. Radix <SelectItem> rejects an
// empty-string value, so the no-app-selected case uses this instead of "".
const ALL_AUDIO_APPS = "__all__";

export function Toolbar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);
  // Tracks the most recent recording source so "Re-edit" can reopen the
  // TrimEditor without loading a desktop recording into browser memory.
  const [lastMedia, setLastMedia] = useState<EditableMedia | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Per-app system audio picker — loaded lazily when system audio is enabled
  const [audioApps, setAudioApps] = useState<AudioApp[]>([]);
  const audioAppsLoadedRef = useRef(false);
  const { settings: buildSoundSettings, playableSoundbites } = useBuildSounds();

  const {
    status,
    devices,
    sectionState,
    browserDevices,
    audioMonitor,
    systemAudioMonitor,
    recordingAnalysers,
    // External frame recording (for 4-section preview)
    externalConfig,
    updateExternalConfig,
    isExternalRecording,
    startExternalRecording,
    stopExternalRecording,
  } = useRecordingContext();

  // Lazy-load the audio app list when system audio is enabled.
  const loadAudioApps = useCallback(async () => {
    if (audioAppsLoadedRef.current) return;
    audioAppsLoadedRef.current = true;
    try {
      const apps = await invoke<AudioApp[]>("list_audio_apps");
      // Drop apps without a bundleId: they can't be targeted by SCK's bundle
      // filter, and an empty value crashes the Radix <SelectItem> below.
      setAudioApps(apps.filter((app) => app.bundleId !== ""));
    } catch {
      // SCK may not have permission yet; leave list empty (shows "Entire system" only)
    }
  }, []);

  // Track output path changes to show save confirmation toast
  const previousOutputPathRef = useRef(status.outputPath);
  useEffect(() => {
    if (status.outputPath && status.outputPath !== previousOutputPathRef.current) {
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

  // Capture each completed recording so "Re-edit" can reopen it.
  useEffect(() => {
    const onReady = (e: Event) => {
      setLastMedia(
        (e as CustomEvent<RecordingReadyForEditDetail>).detail.media,
      );
    };
    window.addEventListener("recordingReadyForEdit", onReady);
    return () => window.removeEventListener("recordingReadyForEdit", onReady);
  }, []);

  const handleOpenFile = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    dispatchRecordingReadyForEdit({ kind: "blob", blob: file });
    e.target.value = "";
  };

  const handleReEdit = () => {
    if (!lastMedia) return;
    dispatchRecordingReadyForEdit(lastMedia);
  };

  // Check for updates once on mount; surface a toast if one is found.
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

  const handleApplyUpdate = async () => {
    if (!pendingUpdate || isExternalRecording || status.isRecording) return;
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
  };

  const handleCheckUpdate = async () => {
    const update = await checkForUpdate();
    if (update) {
      setPendingUpdate(update);
      toast({ title: `Update available: v${update.version}` });
    } else {
      toast({ title: "Up to date", description: "No updates available." });
    }
  };

  // Check if any section has content (for enabling record button)
  const hasContent = sectionState.sections.some(
    (section) => section.source !== null
  );
  const canRecord =
    hasContent || (buildSoundSettings.enabled && playableSoundbites.length > 0);

  const handleRecord = async () => {
    try {
      if (status.isRecording || isExternalRecording) {
        await stopExternalRecording();
        toast({
          title: "Recording stopped",
          description: "Saving recording...",
        });
      } else {
        setLastMedia(null);
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

  const handleExport = () => {
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
        description: "Record something first to export",
      });
    }
  };

  // Count active sections for display
  const activeSectionCount = sectionState.sections.filter(
    (section) => section.source !== null
  ).length;

  return (
    <div className="h-14 border-b border-border bg-card px-4 flex items-center gap-2">
      {/* Recording Settings */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 bg-transparent"
            disabled={status.isRecording || isExternalRecording}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recording Settings</DialogTitle>
            <DialogDescription>
              Configure audio and quality for preview recording
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Video Info */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Video className="h-4 w-4" />
                Video Sources
              </h4>
              <div className="pl-6 text-sm text-muted-foreground">
                <p>
                  {activeSectionCount > 0
                    ? `${activeSectionCount} section${activeSectionCount > 1 ? "s" : ""} active`
                    : "No sections configured"}
                </p>
                <p className="text-xs mt-1">
                  Add sources by clicking the sections in the preview
                </p>
              </div>
            </div>

            {/* Audio Sources */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Volume2 className="h-4 w-4" />
                Audio Sources
              </h4>
              <div className="space-y-3 pl-6">
                {/* Microphone row */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="mic-capture" className="flex items-center gap-2">
                    <Mic className="h-4 w-4" />
                    Microphone
                  </Label>
                  <div className="flex items-center gap-2">
                    {externalConfig.captureMic && (
                      <StereoMeter
                        analyserL={audioMonitor.analyserL}
                        analyserR={audioMonitor.analyserR}
                        className="rounded"
                      />
                    )}
                    <Switch
                      id="mic-capture"
                      checked={externalConfig.captureMic}
                      onCheckedChange={(checked) =>
                        updateExternalConfig({ captureMic: checked })
                      }
                    />
                  </div>
                </div>
                {externalConfig.captureMic && browserDevices.filter(d => d.kind === "audioinput").length > 1 && (
                  <div className="space-y-1">
                    <Select
                      value={externalConfig.micDeviceId ?? "default"}
                      onValueChange={(value) =>
                        updateExternalConfig({ micDeviceId: value === "default" ? undefined : value })
                      }
                    >
                      <SelectTrigger className="w-full h-8 text-xs">
                        <SelectValue placeholder="Default microphone" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default microphone</SelectItem>
                        {browserDevices
                          .filter((d) => d.kind === "audioinput")
                          .map((d) => (
                            <SelectItem key={d.deviceId} value={d.deviceId}>
                              {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* Mic gain slider + mute */}
                {externalConfig.captureMic && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-muted-foreground">Mic Gain</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          title={externalConfig.micMuted ? "Unmute mic" : "Mute mic"}
                          onClick={() => updateExternalConfig({ micMuted: !externalConfig.micMuted })}
                        >
                          {externalConfig.micMuted
                            ? <VolumeX className="h-3 w-3 text-destructive" />
                            : <Mic className="h-3 w-3" />}
                        </Button>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {externalConfig.micMuted ? "muted" : gainToDb(externalConfig.micGain)}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={3}
                      step={0.05}
                      value={[externalConfig.micGain]}
                      onValueChange={([v]) => updateExternalConfig({ micGain: v })}
                      className={externalConfig.micMuted ? "opacity-40" : ""}
                    />
                  </div>
                )}
                {/* High-pass filter toggle */}
                {externalConfig.captureMic && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="mic-highpass" className="text-xs text-muted-foreground">
                      High-pass filter (80 Hz)
                    </Label>
                    <Switch
                      id="mic-highpass"
                      checked={externalConfig.micHighpass}
                      onCheckedChange={(checked) =>
                        updateExternalConfig({ micHighpass: checked })
                      }
                    />
                  </div>
                )}
                {/* System Audio row */}
                <div className="flex items-center justify-between">
                  <Label
                    htmlFor="system-audio"
                    className={`flex items-center gap-2 ${
                      !devices?.hasSystemAudio ? "opacity-50" : ""
                    }`}
                  >
                    <Volume2 className="h-4 w-4" />
                    System Audio
                    {!devices?.hasSystemAudio && (
                      <span className="text-xs text-muted-foreground">
                        (not available)
                      </span>
                    )}
                  </Label>
                  <div className="flex items-center gap-2">
                    {externalConfig.captureSystemAudio && !isExternalRecording && (
                      <StereoMeter
                        analyserL={systemAudioMonitor.analyserL}
                        analyserR={systemAudioMonitor.analyserR}
                        className="rounded"
                      />
                    )}
                    <Switch
                      id="system-audio"
                      checked={externalConfig.captureSystemAudio}
                      onCheckedChange={(checked) => {
                        updateExternalConfig({ captureSystemAudio: checked });
                        if (checked) loadAudioApps();
                      }}
                      disabled={!devices?.hasSystemAudio}
                    />
                  </div>
                </div>
                {/* Per-app system audio picker */}
                {externalConfig.captureSystemAudio && audioApps.length > 0 && (
                  <div className="space-y-1">
                    <Select
                      value={externalConfig.systemAudioApp ?? ALL_AUDIO_APPS}
                      onValueChange={(value) =>
                        updateExternalConfig({
                          systemAudioApp:
                            value === ALL_AUDIO_APPS ? undefined : value,
                        })
                      }
                    >
                      <SelectTrigger className="w-full h-8 text-xs">
                        <SelectValue placeholder="Entire system (all apps)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_AUDIO_APPS}>
                          Entire system (all apps)
                        </SelectItem>
                        {audioApps.map((app) => (
                          <SelectItem key={app.bundleId} value={app.bundleId}>
                            {app.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {/* System audio gain slider + mute */}
                {externalConfig.captureSystemAudio && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Label className="text-xs text-muted-foreground">System Audio Gain</Label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          title={externalConfig.systemAudioMuted ? "Unmute system audio" : "Mute system audio"}
                          onClick={() =>
                            updateExternalConfig({ systemAudioMuted: !externalConfig.systemAudioMuted })
                          }
                        >
                          {externalConfig.systemAudioMuted
                            ? <VolumeX className="h-3 w-3 text-destructive" />
                            : <Volume2 className="h-3 w-3" />}
                        </Button>
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {externalConfig.systemAudioMuted
                          ? "muted"
                          : gainToDb(externalConfig.systemAudioGain)}
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={3}
                      step={0.05}
                      value={[externalConfig.systemAudioGain]}
                      onValueChange={([v]) => updateExternalConfig({ systemAudioGain: v })}
                      className={externalConfig.systemAudioMuted ? "opacity-40" : ""}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Quality Settings */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Quality</h4>
              <div className="space-y-3 pl-6">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Video Quality
                  </Label>
                  <Select
                    value={externalConfig.videoQuality}
                    onValueChange={(value: VideoQuality) =>
                      updateExternalConfig({ videoQuality: value })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low (2.5 Mbps)</SelectItem>
                      <SelectItem value="medium">Medium (5 Mbps)</SelectItem>
                      <SelectItem value="high">High (10 Mbps)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Frame Rate
                  </Label>
                  <Select
                    value={String(externalConfig.frameRate || 30)}
                    onValueChange={(value) =>
                      updateExternalConfig({ frameRate: parseInt(value) })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24 fps</SelectItem>
                      <SelectItem value="30">30 fps</SelectItem>
                      <SelectItem value="60">60 fps</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Output Resolution (16:9)
                  </Label>
                  <Select
                    value={externalConfig.outputResolution || "hd1080"}
                    onValueChange={(value: OutputResolution) =>
                      updateExternalConfig({ outputResolution: value })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(OUTPUT_RESOLUTIONS).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    Layout
                  </Label>
                  <Select
                    value={externalConfig.layout}
                    onValueChange={(value: LayoutType) =>
                      updateExternalConfig({ layout: value })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(LAYOUT_LABELS) as [LayoutType, string][]).map(
                        ([key, label]) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  {externalConfig.layout === "pip" && (
                    <div className="space-y-2 pt-1">
                      <Label className="text-xs text-muted-foreground">
                        PiP Corner
                      </Label>
                      <Select
                        value={externalConfig.pipPosition}
                        onValueChange={(value: PipPosition) =>
                          updateExternalConfig({ pipPosition: value })
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="top-left">Top Left</SelectItem>
                          <SelectItem value="top-right">Top Right</SelectItem>
                          <SelectItem value="bottom-left">Bottom Left</SelectItem>
                          <SelectItem value="bottom-right">Bottom Right</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={handleCheckUpdate}
              >
                Check for updates
              </button>
              {pendingUpdate && (
                <span className="text-xs text-amber-500">
                  v{pendingUpdate.version} available
                </span>
              )}
            </div>

            {!canRecord && (
              <p className="text-sm text-destructive">
                Add a video source or enable Build Sounds with a playable clip
                before recording
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <BuildSoundsDialog isRecording={status.isRecording || isExternalRecording} />

      {/* Main Record Button */}
      <Button
        variant={status.isRecording || isExternalRecording ? "destructive" : "default"}
        size="sm"
        className="gap-2"
        onClick={handleRecord}
        disabled={!canRecord}
      >
        {status.isRecording || isExternalRecording ? (
          <>
            <Square className="h-4 w-4" />
            Stop
          </>
        ) : (
          <>
            <Circle className="h-4 w-4 fill-current" />
            Record
          </>
        )}
      </Button>

      <Separator orientation="vertical" className="h-6" />

      {/* Source Indicators */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {/* Section count indicator */}
        {activeSectionCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-muted">
            <Video className="h-3 w-3" />
            <span>{activeSectionCount}</span>
          </div>
        )}
        {externalConfig.captureMic && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-muted">
            <Mic className="h-3 w-3" />
          </div>
        )}
        {externalConfig.captureSystemAudio && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-muted">
            <Volume2 className="h-3 w-3" />
          </div>
        )}
      </div>

      <Separator orientation="vertical" className="h-6" />

      {/* Open recording file */}
      <Button
        variant="outline"
        size="sm"
        className="gap-2 bg-transparent"
        onClick={handleOpenFile}
        title="Open a saved recording for editing"
      >
        <FolderOpen className="h-4 w-4" />
        Open
      </Button>

      {/* Re-edit last recording (shown after a recording completes) */}
      {lastMedia && !isExternalRecording && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2 bg-transparent"
          onClick={handleReEdit}
          title="Reopen the last recording in the trim editor"
        >
          <RotateCcw className="h-4 w-4" />
          Re-edit
        </Button>
      )}

      {/* Export */}
      <Button
        variant="outline"
        size="sm"
        className="gap-2 bg-transparent"
        onClick={handleExport}
      >
        <Download className="h-4 w-4" />
        Export
      </Button>

      {/* Update available indicator */}
      {pendingUpdate && !isApplyingUpdate && (
        <Button
          variant="outline"
          size="sm"
          className="gap-2 bg-transparent text-amber-500"
          onClick={handleApplyUpdate}
          disabled={status.isRecording || isExternalRecording}
          title={`Update to v${pendingUpdate.version} — will relaunch`}
        >
          <Download className="h-4 w-4" />
          Update
        </Button>
      )}
      {isApplyingUpdate && (
        <span className="text-sm text-muted-foreground font-mono">
          {Math.round(updateProgress * 100)}%…
        </span>
      )}

      {/* Hidden file input for opening saved recordings */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,.mp4"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex-1" />

      {/* Recording Indicator + live per-source level meters */}
      {(status.isRecording || isExternalRecording) && (
        <div className="flex items-center gap-2 text-destructive">
          <Circle className="h-3 w-3 fill-current animate-pulse" />
          <span className="text-sm font-medium">Recording</span>
          <span className="text-sm font-mono">
            {formatDuration(status.durationMs)}
          </span>
          {recordingAnalysers.mic && (
            <StereoMeter
              analyserL={recordingAnalysers.mic}
              analyserR={recordingAnalysers.mic}
              className="rounded"
            />
          )}
          {recordingAnalysers.sys && (
            <StereoMeter
              analyserL={recordingAnalysers.sys}
              analyserR={recordingAnalysers.sys}
              className="rounded"
            />
          )}
        </div>
      )}

      {/* Timeline Position */}
      {!status.isRecording && !isExternalRecording && (
        <div className="text-sm text-muted-foreground font-mono">
          {formatDuration(status.durationMs)} / {formatDuration(status.durationMs)}
        </div>
      )}
    </div>
  );
}
