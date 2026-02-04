import { useState } from "react";
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
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Circle,
  Settings,
  Video,
  Volume2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRecordingContext } from "@/contexts/recording-context";
import { formatDuration, OUTPUT_RESOLUTIONS } from "@/types/recording";
import type { VideoQuality, OutputResolution } from "@/types/recording";

export function Toolbar() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const {
    status,
    devices,
    sectionState,
    // External frame recording (for 4-section preview)
    externalConfig,
    updateExternalConfig,
    isExternalRecording,
    startExternalRecording,
    stopExternalRecording,
  } = useRecordingContext();

  // Check if any section has content (for enabling record button)
  const hasContent = sectionState.sections.some(
    (section) => section.source !== null
  );

  const handleRecord = async () => {
    try {
      if (status.isRecording || isExternalRecording) {
        const outputPath = await stopExternalRecording();
        toast({
          title: "Recording stopped",
          description: `Saved to: ${outputPath}`,
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

  const handlePlay = () => {
    setIsPlaying(!isPlaying);
    window.dispatchEvent(
      new CustomEvent("timelinePlayback", {
        detail: { isPlaying: !isPlaying },
      })
    );
  };

  const handleStop = async () => {
    if (status.isRecording || isExternalRecording) {
      try {
        await stopExternalRecording();
        toast({
          title: "Recording stopped",
          description: "Recording has been saved",
        });
      } catch (err) {
        toast({
          title: "Failed to stop recording",
          description: String(err),
          variant: "destructive",
        });
      }
    }
    setIsPlaying(false);
    window.dispatchEvent(
      new CustomEvent("timelinePlayback", {
        detail: { isPlaying: false },
      })
    );
  };

  const handleExport = () => {
    if (status.outputPath) {
      toast({
        title: "Recording available",
        description: `File: ${status.outputPath}`,
      });
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="mic-capture" className="flex items-center gap-2">
                    <Mic className="h-4 w-4" />
                    Microphone
                  </Label>
                  <Switch
                    id="mic-capture"
                    checked={externalConfig.captureMic}
                    onCheckedChange={(checked) =>
                      updateExternalConfig({ captureMic: checked })
                    }
                  />
                </div>
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
                  <Switch
                    id="system-audio"
                    checked={externalConfig.captureSystemAudio}
                    onCheckedChange={(checked) =>
                      updateExternalConfig({ captureSystemAudio: checked })
                    }
                    disabled={!devices?.hasSystemAudio}
                  />
                </div>
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
              </div>
            </div>

            {!hasContent && (
              <p className="text-sm text-destructive">
                Add at least one source to a section before recording
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Main Record Button */}
      <Button
        variant={status.isRecording || isExternalRecording ? "destructive" : "default"}
        size="sm"
        className="gap-2"
        onClick={handleRecord}
        disabled={!hasContent}
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

      {/* Playback Controls */}
      <Button variant="outline" size="sm" className="bg-transparent">
        <SkipBack className="h-4 w-4" />
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handlePlay}
        disabled={status.isRecording || isExternalRecording}
        className="bg-transparent"
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="bg-transparent"
        onClick={handleStop}
        disabled={!isPlaying && !status.isRecording && !isExternalRecording}
      >
        <Square className="h-4 w-4" />
      </Button>

      <Button variant="outline" size="sm" className="bg-transparent">
        <SkipForward className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-6" />

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

      <div className="flex-1" />

      {/* Recording Indicator */}
      {(status.isRecording || isExternalRecording) && (
        <div className="flex items-center gap-2 text-destructive">
          <Circle className="h-3 w-3 fill-current animate-pulse" />
          <span className="text-sm font-medium">Recording</span>
          <span className="text-sm font-mono">
            {formatDuration(status.durationMs)}
          </span>
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
