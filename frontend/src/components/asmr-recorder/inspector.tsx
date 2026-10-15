import { useRef, useCallback, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Mic,
  Volume2,
  VolumeX,
  Monitor,
  Camera,
  LayoutGrid,
  Square,
  Columns2,
  PictureInPicture2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useRecordingContext } from "@/contexts/recording-context";
import { OUTPUT_RESOLUTIONS } from "@/types/recording";
import type {
  VideoQuality,
  OutputResolution,
  LayoutType,
  PipPosition,
} from "@/types/recording";
import { LAYOUT_LABELS } from "@/lib/layouts";
import { gainToDb } from "@/lib/gain-to-db";
import { StereoMeter } from "./audio-monitor-graphics";
import type { Update } from "@/lib/updater";

interface AudioApp {
  bundleId: string;
  name: string;
  pid: number;
}

const ALL_AUDIO_APPS = "__all__";

interface InspectorProps {
  pendingUpdate: Update | null;
  onCheckUpdate: () => void;
}

const LAYOUT_ICONS: Record<LayoutType, React.ReactNode> = {
  "grid-2x2": <LayoutGrid />,
  solo: <Square />,
  "side-by-side": <Columns2 />,
  pip: <PictureInPicture2 />,
};

const layoutOptions = (
  Object.entries(LAYOUT_LABELS) as [LayoutType, string][]
).map(([value, label]) => ({
  value,
  label,
  icon: LAYOUT_ICONS[value],
}));

export function Inspector({ pendingUpdate, onCheckUpdate }: InspectorProps) {
  const {
    status,
    devices,
    sectionState,
    browserDevices,
    audioMonitor,
    systemAudioMonitor,
    externalConfig,
    updateExternalConfig,
    isExternalRecording,
  } = useRecordingContext();

  const [audioApps, setAudioApps] = useState<AudioApp[]>([]);
  const audioAppsLoadedRef = useRef(false);

  const isLocked = status.isRecording || isExternalRecording;

  const loadAudioApps = useCallback(async () => {
    if (audioAppsLoadedRef.current) return;
    audioAppsLoadedRef.current = true;
    try {
      const apps = await invoke<AudioApp[]>("list_audio_apps");
      setAudioApps(apps.filter((app) => app.bundleId !== ""));
    } catch {
      // SCK may not have permission yet; leave list empty
    }
  }, []);

  return (
    <div className="w-[264px] h-full flex flex-col">
      {isLocked && (
        <div className="px-3 py-2 border-b border-separator shrink-0">
          <p className="text-caption text-muted-foreground">
            Settings are locked while recording
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Sources */}
        <div className="px-3 py-3">
          <h2 className="text-headline text-foreground mb-2">Sources</h2>
          <div className="space-y-0.5">
            {sectionState.sections.map((section, i) => (
              <div
                key={i}
                className="flex items-center gap-2 h-7 rounded-md px-1.5"
              >
                <span className="text-caption text-muted-foreground w-4 shrink-0 tabular-nums text-right">
                  {i + 1}
                </span>
                {section.source === "screen" ? (
                  <Monitor className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : section.source === "camera" ? (
                  <Camera className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-dashed border-separator" />
                )}
                <span
                  className={`text-body truncate flex-1 ${
                    section.source
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {section.source === "camera"
                    ? (section.deviceName ?? "Camera")
                    : section.source === "screen"
                    ? "Display"
                    : "Empty"}
                </span>
                {isLocked && section.source && (
                  <span className="h-1.5 w-1.5 rounded-full bg-record shrink-0" />
                )}
              </div>
            ))}
          </div>
          {!sectionState.sections.some((s) => s.source) && (
            <p className="text-caption text-muted-foreground mt-1.5 pl-6">
              Add a source to start recording
            </p>
          )}
        </div>

        <Separator />

        {/* Audio */}
        <div className="px-3 py-3 space-y-3">
          <h2 className="text-headline text-foreground">Audio</h2>

          {/* Microphone row */}
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor="insp-mic"
              className="flex items-center gap-1.5 text-body"
            >
              <Mic className="h-3.5 w-3.5 shrink-0" />
              Microphone
            </Label>
            <div className="flex items-center gap-1.5">
              {externalConfig.captureMic && (
                <StereoMeter
                  analyserL={audioMonitor.analyserL}
                  analyserR={audioMonitor.analyserR}
                  className="rounded"
                />
              )}
              <Switch
                id="insp-mic"
                checked={externalConfig.captureMic}
                disabled={isLocked}
                onCheckedChange={(checked) =>
                  updateExternalConfig({ captureMic: checked })
                }
              />
            </div>
          </div>

          {externalConfig.captureMic && (
            <div className="pl-6 space-y-2">
              {browserDevices.filter((d) => d.kind === "audioinput").length >
                1 && (
                <Select
                  value={externalConfig.micDeviceId ?? "default"}
                  onValueChange={(value) =>
                    updateExternalConfig({
                      micDeviceId: value === "default" ? undefined : value,
                    })
                  }
                  disabled={isLocked}
                >
                  <SelectTrigger className="w-full">
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
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1">
                    <span className="text-caption text-muted-foreground">
                      Gain
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={
                            externalConfig.micMuted
                              ? "Unmute microphone"
                              : "Mute microphone"
                          }
                          disabled={isLocked}
                          onClick={() =>
                            updateExternalConfig({
                              micMuted: !externalConfig.micMuted,
                            })
                          }
                        >
                          {externalConfig.micMuted ? (
                            <VolumeX className="h-3 w-3 text-destructive" />
                          ) : (
                            <Mic className="h-3 w-3" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {externalConfig.micMuted
                          ? "Unmute microphone"
                          : "Mute microphone"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {externalConfig.micMuted
                      ? "muted"
                      : gainToDb(externalConfig.micGain)}
                  </span>
                </div>
                <Slider
                  min={0}
                  max={3}
                  step={0.05}
                  value={[externalConfig.micGain]}
                  onValueChange={([v]) => updateExternalConfig({ micGain: v })}
                  disabled={isLocked}
                  className={externalConfig.micMuted ? "opacity-40" : ""}
                />
              </div>

              <div className="flex items-center justify-between">
                <Label
                  htmlFor="insp-highpass"
                  className="text-caption text-muted-foreground"
                >
                  High-pass 80 Hz
                </Label>
                <Switch
                  id="insp-highpass"
                  checked={externalConfig.micHighpass}
                  disabled={isLocked}
                  onCheckedChange={(checked) =>
                    updateExternalConfig({ micHighpass: checked })
                  }
                />
              </div>
            </div>
          )}

          {/* System Audio row */}
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor="insp-sysaudio"
              className={`flex items-center gap-1.5 text-body ${
                !devices?.hasSystemAudio ? "opacity-40" : ""
              }`}
            >
              <Volume2 className="h-3.5 w-3.5 shrink-0" />
              System Audio
            </Label>
            <div className="flex items-center gap-1.5">
              {externalConfig.captureSystemAudio && !isExternalRecording && (
                <StereoMeter
                  analyserL={systemAudioMonitor.analyserL}
                  analyserR={systemAudioMonitor.analyserR}
                  className="rounded"
                />
              )}
              <Switch
                id="insp-sysaudio"
                checked={externalConfig.captureSystemAudio}
                disabled={isLocked || !devices?.hasSystemAudio}
                onCheckedChange={(checked) => {
                  updateExternalConfig({ captureSystemAudio: checked });
                  if (checked) loadAudioApps();
                }}
              />
            </div>
          </div>

          {!devices?.hasSystemAudio && (
            <p className="text-caption text-tertiary-foreground pl-6">
              Not available
            </p>
          )}

          {externalConfig.captureSystemAudio && (
            <div className="pl-6 space-y-2">
              {audioApps.length > 0 && (
                <Select
                  value={externalConfig.systemAudioApp ?? ALL_AUDIO_APPS}
                  onValueChange={(value) =>
                    updateExternalConfig({
                      systemAudioApp:
                        value === ALL_AUDIO_APPS ? undefined : value,
                    })
                  }
                  disabled={isLocked}
                >
                  <SelectTrigger className="w-full">
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
              )}

              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1">
                    <span className="text-caption text-muted-foreground">
                      Gain
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={
                            externalConfig.systemAudioMuted
                              ? "Unmute system audio"
                              : "Mute system audio"
                          }
                          disabled={isLocked}
                          onClick={() =>
                            updateExternalConfig({
                              systemAudioMuted: !externalConfig.systemAudioMuted,
                            })
                          }
                        >
                          {externalConfig.systemAudioMuted ? (
                            <VolumeX className="h-3 w-3 text-destructive" />
                          ) : (
                            <Volume2 className="h-3 w-3" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {externalConfig.systemAudioMuted
                          ? "Unmute system audio"
                          : "Mute system audio"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-caption text-muted-foreground tabular-nums">
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
                  onValueChange={([v]) =>
                    updateExternalConfig({ systemAudioGain: v })
                  }
                  disabled={isLocked}
                  className={externalConfig.systemAudioMuted ? "opacity-40" : ""}
                />
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Video */}
        <div className="px-3 py-3 space-y-3">
          <h2 className="text-headline text-foreground">Video</h2>

          <div className="flex items-center gap-2">
            <Label className="text-body w-[72px] shrink-0">Layout</Label>
            <SegmentedControl
              value={externalConfig.layout}
              onValueChange={(value: LayoutType) =>
                updateExternalConfig({ layout: value })
              }
              options={layoutOptions}
              disabled={isLocked}
              aria-label="Layout"
            />
          </div>

          {externalConfig.layout === "pip" && (
            <div className="flex items-center justify-between gap-2">
              <Label className="text-body w-[72px] shrink-0">PiP Corner</Label>
              <Select
                value={externalConfig.pipPosition}
                onValueChange={(value: PipPosition) =>
                  updateExternalConfig({ pipPosition: value })
                }
                disabled={isLocked}
              >
                <SelectTrigger className="flex-1 min-w-0">
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

          <div className="flex items-center justify-between gap-2">
            <Label className="text-body w-[72px] shrink-0">Resolution</Label>
            <Select
              value={externalConfig.outputResolution || "hd1080"}
              onValueChange={(value: OutputResolution) =>
                updateExternalConfig({ outputResolution: value })
              }
              disabled={isLocked}
            >
              <SelectTrigger className="flex-1 min-w-0">
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

          <div className="flex items-center justify-between gap-2">
            <Label className="text-body w-[72px] shrink-0">Frame Rate</Label>
            <Select
              value={String(externalConfig.frameRate || 30)}
              onValueChange={(value) =>
                updateExternalConfig({ frameRate: parseInt(value) })
              }
              disabled={isLocked}
            >
              <SelectTrigger className="flex-1 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 fps</SelectItem>
                <SelectItem value="30">30 fps</SelectItem>
                <SelectItem value="60">60 fps</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label className="text-body w-[72px] shrink-0">Quality</Label>
            <Select
              value={externalConfig.videoQuality}
              onValueChange={(value: VideoQuality) =>
                updateExternalConfig({ videoQuality: value })
              }
              disabled={isLocked}
            >
              <SelectTrigger className="flex-1 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        {/* Footer */}
        <div className="px-3 py-3 flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-caption text-muted-foreground hover:text-foreground h-auto px-1 py-0.5"
            onClick={onCheckUpdate}
          >
            Check for Updates
          </Button>
          {pendingUpdate && (
            <span className="text-caption text-warning shrink-0">
              v{pendingUpdate.version} available
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
