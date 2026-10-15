import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Film } from "lucide-react";
import { useRecordingContext } from "@/contexts/recording-context";
import { StereoMeter, Spectrum } from "./audio-monitor-graphics";

/** mm:ss from a seconds value. */
function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Clip {
  name: string;
  durationSec: number | null;
  blob: Blob;
}

/**
 * Monitor strip: live input meters + clip chip for the most recent recording.
 *
 * Keeps all event wiring from the original Timeline: listens for
 * recordingReadyForEdit to populate the clip, and the clip chip dispatches the
 * same event to re-open the TrimEditor.
 */
export function Timeline() {
  const { audioMonitor } = useRecordingContext();
  const [clip, setClip] = useState<Clip | null>(null);

  // Populate from the most recent finished/opened recording (same event the
  // TrimEditor consumes). Read duration from a throwaway <video> (metadata only).
  useEffect(() => {
    const onReady = (event: Event) => {
      const blob = (event as CustomEvent<{ blob?: Blob }>).detail?.blob;
      if (!blob) return;
      const name = blob instanceof File ? blob.name : "Recording";

      const url = URL.createObjectURL(blob);
      const probe = document.createElement("video");
      probe.preload = "metadata";
      const done = (durationSec: number | null) => {
        setClip({ name, durationSec, blob });
        URL.revokeObjectURL(url);
      };
      probe.onloadedmetadata = () =>
        done(Number.isFinite(probe.duration) ? probe.duration : null);
      probe.onerror = () => done(null);
      probe.src = url;
    };

    window.addEventListener("recordingReadyForEdit", onReady);
    return () => window.removeEventListener("recordingReadyForEdit", onReady);
  }, []);

  // Re-open the clip in the TrimEditor (the surface that does real playback/trim).
  const openInEditor = () => {
    if (!clip) return;
    window.dispatchEvent(
      new CustomEvent("recordingReadyForEdit", { detail: { blob: clip.blob } }),
    );
  };

  return (
    <div className="h-full px-3 flex items-center gap-3 bg-surface border-t">
      <span className="text-caption text-muted-foreground shrink-0">Input</span>
      <StereoMeter
        analyserL={audioMonitor.analyserL}
        analyserR={audioMonitor.analyserR}
      />
      <div className="relative flex-1 min-w-0 h-8 rounded-md bg-fill/60 overflow-hidden">
        <Spectrum
          analyser={audioMonitor.analyserMix}
          className="absolute inset-0 w-full h-full"
        />
      </div>
      <Separator orientation="vertical" className="h-6 shrink-0" />
      {clip ? (
        <Button
          variant="secondary"
          size="lg"
          className="px-2.5 gap-2 shrink-0"
          onClick={openInEditor}
        >
          <Film className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="max-w-[220px] truncate">{clip.name}</span>
          {clip.durationSec != null && (
            <span className="tabular-nums text-muted-foreground">
              {formatDuration(clip.durationSec)}
            </span>
          )}
          <span className="text-foreground font-medium">Edit</span>
        </Button>
      ) : (
        <span className="text-caption text-tertiary-foreground shrink-0">
          No recording yet
        </span>
      )}
    </div>
  );
}
