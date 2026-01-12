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
import { Slider } from "@/components/ui/slider";
import {
  Mic,
  Monitor,
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
  Camera,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useRecordingContext } from "@/contexts/recording-context";
import { formatDuration } from "@/types/recording";
import type { PipPosition, VideoQuality } from "@/types/recording";

export function Toolbar() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const {
    config,
    updateConfig,
    status,
    devices,
    startRecording,
    stopRecording,
  } = useRecordingContext();

  const handleRecord = async () => {
    try {
      if (status.isRecording) {
        const outputPath = await stopRecording();
        toast({
          title: "Recording stopped",
          description: `Saved to: ${outputPath}`,
        });
      } else {
        await startRecording();
        toast({
          title: "Recording started",
          description: "Recording in progress...",
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
    if (status.isRecording) {
      try {
        await stopRecording();
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

  // Check if any video source is enabled
  const hasVideoSource = config.captureScreen || config.captureWebcam;

  return (
    <div className="h-14 border-b border-border bg-card px-4 flex items-center gap-2">
      {/* Recording Settings */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 bg-transparent"
            disabled={status.isRecording}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recording Settings</DialogTitle>
            <DialogDescription>
              Configure your video and audio sources
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Video Sources */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Video className="h-4 w-4" />
                Video Sources
              </h4>
              <div className="space-y-3 pl-6">
                <div className="flex items-center justify-between">
                  <Label htmlFor="screen-capture" className="flex items-center gap-2">
                    <Monitor className="h-4 w-4" />
                    Screen Capture
                  </Label>
                  <Switch
                    id="screen-capture"
                    checked={config.captureScreen}
                    onCheckedChange={(checked) =>
                      updateConfig({ captureScreen: checked })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="webcam-capture" className="flex items-center gap-2">
                    <Camera className="h-4 w-4" />
                    Webcam (PiP)
                  </Label>
                  <Switch
                    id="webcam-capture"
                    checked={config.captureWebcam}
                    onCheckedChange={(checked) =>
                      updateConfig({ captureWebcam: checked })
                    }
                  />
                </div>
                {config.captureWebcam && (
                  <div className="space-y-3 pl-6 border-l-2 border-muted">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        PiP Position
                      </Label>
                      <Select
                        value={config.webcamPosition}
                        onValueChange={(value: PipPosition) =>
                          updateConfig({ webcamPosition: value })
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
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        PiP Size: {config.webcamSize}%
                      </Label>
                      <Slider
                        value={[config.webcamSize]}
                        onValueChange={([value]) =>
                          updateConfig({ webcamSize: value })
                        }
                        min={10}
                        max={50}
                        step={5}
                      />
                    </div>
                  </div>
                )}
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
                    checked={config.captureMic}
                    onCheckedChange={(checked) =>
                      updateConfig({ captureMic: checked })
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
                    checked={config.captureSystemAudio}
                    onCheckedChange={(checked) =>
                      updateConfig({ captureSystemAudio: checked })
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
                    value={config.videoQuality}
                    onValueChange={(value: VideoQuality) =>
                      updateConfig({ videoQuality: value })
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
                    value={String(config.frameRate || 30)}
                    onValueChange={(value) =>
                      updateConfig({ frameRate: parseInt(value) })
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
              </div>
            </div>

            {!hasVideoSource && (
              <p className="text-sm text-destructive">
                Please enable at least one video source
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Main Record Button */}
      <Button
        variant={status.isRecording ? "destructive" : "default"}
        size="sm"
        className="gap-2"
        onClick={handleRecord}
        disabled={!hasVideoSource}
      >
        {status.isRecording ? (
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
        {config.captureScreen && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-muted">
            <Monitor className="h-3 w-3" />
          </div>
        )}
        {config.captureWebcam && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-muted">
            <Camera className="h-3 w-3" />
          </div>
        )}
        {config.captureMic && (
          <div className="flex items-center gap-1 px-2 py-1 rounded bg-muted">
            <Mic className="h-3 w-3" />
          </div>
        )}
        {config.captureSystemAudio && (
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
        disabled={status.isRecording}
        className="bg-transparent"
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="bg-transparent"
        onClick={handleStop}
        disabled={!isPlaying && !status.isRecording}
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
      {status.isRecording && (
        <div className="flex items-center gap-2 text-destructive">
          <Circle className="h-3 w-3 fill-current animate-pulse" />
          <span className="text-sm font-medium">Recording</span>
          <span className="text-sm font-mono">
            {formatDuration(status.durationMs)}
          </span>
        </div>
      )}

      {/* Timeline Position */}
      {!status.isRecording && (
        <div className="text-sm text-muted-foreground font-mono">
          {formatDuration(status.durationMs)} / {formatDuration(status.durationMs)}
        </div>
      )}
    </div>
  );
}
