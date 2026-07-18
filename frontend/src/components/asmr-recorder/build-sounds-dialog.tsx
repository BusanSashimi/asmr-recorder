import { useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Hammer,
  Play,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useBuildSounds } from "@/contexts/build-sound-context";
import type { BuildSoundSelectionMode } from "@/types/build-sounds";

interface BuildSoundsDialogProps {
  isRecording: boolean;
}

function formatClock(timestamp: number | null) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : "—";
}

function portFromLoopbackUrl(value: string): number | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
    ) {
      return null;
    }
    const port = Number(url.port);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

function VolumeControl({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Recording volume</Label>
        <span className="text-xs tabular-nums text-muted-foreground">{draft}%</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={1}
        value={[draft]}
        disabled={disabled}
        onValueChange={([volume]) => setDraft(volume)}
        onValueCommit={([volume]) => onCommit(volume)}
      />
    </div>
  );
}

export function BuildSoundsDialog({ isRecording }: BuildSoundsDialogProps) {
  const {
    settings,
    soundbites,
    playableSoundbites,
    bridgeStatus,
    loading,
    updateSettings,
    importFiles,
    deleteSoundbite,
    moveSoundbite,
    previewSoundbite,
  } = useBuildSounds();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ordered = settings.orderedSoundbiteIds.flatMap((id) => {
    const item = soundbites.find((candidate) => candidate.id === id);
    return item ? [item] : [];
  });

  const commitUrl = async (input: HTMLInputElement) => {
    const monitoredUrl = input.value.trim();
    const port = portFromLoopbackUrl(monitoredUrl);
    if (!port) {
      input.value = settings.monitoredUrl;
      toast({
        title: "Invalid monitored URL",
        description: "Use an explicit loopback URL such as http://localhost:5174.",
        variant: "destructive",
      });
      return;
    }
    try {
      await updateSettings({
        monitoredUrl,
        monitoredPort: port,
      });
    } catch (error) {
      toast({ title: "Could not save URL", description: String(error), variant: "destructive" });
    }
  };

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const result = await importFiles(files);
    if (result.imported) {
      toast({
        title: `${result.imported} soundbite${result.imported === 1 ? "" : "s"} imported`,
      });
    }
    if (result.errors.length) {
      toast({
        title: "Some soundbites were not imported",
        description: result.errors.join(" · "),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 bg-transparent">
          <Hammer className="h-4 w-4" />
          Build Sounds
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Build Sounds</DialogTitle>
          <DialogDescription>
            Mix a soundbite into the recording after each successful Vite update.
            Clips are never sent to your speakers while recording.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="build-sounds-enabled">Enable build-triggered sounds</Label>
                <p className="text-xs text-muted-foreground">
                  {playableSoundbites.length
                    ? `${playableSoundbites.length} playable clip${playableSoundbites.length === 1 ? "" : "s"}`
                    : "Import a playable clip to enable this feature"}
                </p>
              </div>
              <Switch
                id="build-sounds-enabled"
                checked={settings.enabled}
                disabled={loading || isRecording || playableSoundbites.length === 0}
                onCheckedChange={(enabled) => void updateSettings({ enabled })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="build-sounds-url" className="text-xs text-muted-foreground">
                Monitored loopback URL
              </Label>
              <input
                key={settings.monitoredUrl}
                id="build-sounds-url"
                defaultValue={settings.monitoredUrl}
                onBlur={(event) => void commitUrl(event.currentTarget)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                disabled={isRecording}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                spellCheck={false}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-muted-foreground">Connection</span>
              <span className={bridgeStatus.state === "connected" ? "text-emerald-600" : "text-amber-600"}>
                {bridgeStatus.state === "connected" ? "Connected" : "Waiting for plugin"}
              </span>
              <span className="text-muted-foreground">Project</span>
              <span>{bridgeStatus.projectName ?? "—"}</span>
              <span className="text-muted-foreground">Actual port</span>
              <span>{bridgeStatus.actualPort ?? settings.monitoredPort}</span>
              <span className="text-muted-foreground">Last successful event</span>
              <span>{formatClock(bridgeStatus.lastEvent)}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium">Soundbite catalog</h4>
                <p className="text-xs text-muted-foreground">Audio files up to 25 MB and 30 seconds.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isRecording}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" /> Import
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                onChange={(event) => void handleFiles(event)}
              />
            </div>

            {ordered.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No soundbites imported yet.
              </div>
            ) : (
              <div className="space-y-2">
                {ordered.map((item, index) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-md border p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.duration.toFixed(1)}s · {(item.byteSize / 1024).toFixed(0)} KB
                        {!item.available && " · unavailable"}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      aria-label={`Preview ${item.displayName}`}
                      title="Preview"
                      disabled={isRecording || !item.available}
                      onClick={() =>
                        void previewSoundbite(item.id).catch((error) =>
                          toast({
                            title: "Preview failed",
                            description: String(error),
                            variant: "destructive",
                          }),
                        )
                      }
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      aria-label={`Move ${item.displayName} up`}
                      disabled={isRecording || index === 0}
                      onClick={() => void moveSoundbite(item.id, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      aria-label={`Move ${item.displayName} down`}
                      disabled={isRecording || index === ordered.length - 1}
                      onClick={() => void moveSoundbite(item.id, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive"
                      aria-label={`Delete ${item.displayName}`}
                      disabled={isRecording}
                      onClick={() => void deleteSoundbite(item.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Selection order</Label>
              <Select
                value={settings.selectionMode}
                onValueChange={(selectionMode: BuildSoundSelectionMode) =>
                  void updateSettings({ selectionMode })
                }
                disabled={isRecording}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequential">Sequential</SelectItem>
                  <SelectItem value="shuffle">Shuffle bag</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <VolumeControl
              key={settings.volume}
              value={settings.volume}
              disabled={isRecording}
              onCommit={(volume) => void updateSettings({ volume })}
            />
          </div>

          <div className="space-y-2 rounded-md bg-muted p-3 text-xs">
            <h4 className="font-medium text-foreground">Companion plugin setup</h4>
            <p>Install the repository package in the Vite project you want to monitor:</p>
            <code className="block overflow-x-auto rounded bg-background p-2">npm install -D vite-plugin-asmr-recorder</code>
            <p>Add it to <code>vite.config.ts</code> and reserve the monitored port:</p>
            <pre className="overflow-x-auto whitespace-pre rounded bg-background p-2">{`import buildSoundMonitor from "vite-plugin-asmr-recorder";

export default defineConfig({
  plugins: [buildSoundMonitor()],
  server: { port: ${settings.monitoredPort}, strictPort: true },
});`}</pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
