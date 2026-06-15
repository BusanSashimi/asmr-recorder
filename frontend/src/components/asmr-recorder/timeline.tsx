import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Film, Pencil } from "lucide-react";
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
 * Read-only view of the current recording plus live input meters.
 *
 * This is intentionally NOT a multi-track editor: a recording is a single
 * composited MP4, and real playback/scrubbing/trimming lives in the TrimEditor.
 * The timeline shows the recorded clip (name + duration) and hands editing off
 * to that editor; during setup/recording it shows the live audio meters.
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
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="h-12 border-b border-border px-4 flex items-center gap-3">
        <div className="text-sm font-medium">Timeline</div>
        <div className="flex-1" />
        {clip && (
          <>
            {clip.durationSec != null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDuration(clip.durationSec)}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-2 bg-transparent"
              onClick={openInEditor}
            >
              <Pencil className="h-4 w-4" />
              Open in editor
            </Button>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 p-4 flex flex-col gap-4 overflow-auto">
        {/* Live input meters (real — useful while monitoring/recording) */}
        <div className="flex items-center gap-3">
          <span className="w-20 flex-shrink-0 text-xs text-muted-foreground">
            Live audio
          </span>
          <StereoMeter
            analyserL={audioMonitor.analyserL}
            analyserR={audioMonitor.analyserR}
            className="flex-shrink-0 rounded-sm"
          />
          <div className="relative h-10 flex-1 overflow-hidden rounded border border-border bg-background">
            <Spectrum
              analyser={audioMonitor.analyserMix}
              className="absolute inset-0 block h-full w-full opacity-90 pointer-events-none"
            />
          </div>
        </div>

        {/* Recorded clip (read-only) — opens the editor on click */}
        {clip ? (
          <button
            type="button"
            onClick={openInEditor}
            title="Open this recording in the trim editor"
            className="group flex w-full items-center gap-3 rounded-md border border-blue-600 bg-blue-500/80 px-3 py-2 text-left transition-colors hover:bg-blue-500/90"
          >
            <Film className="h-5 w-5 flex-shrink-0 text-white" />
            <span className="flex-1 truncate text-sm font-medium text-white">
              {clip.name}
            </span>
            {clip.durationSec != null && (
              <span className="text-xs tabular-nums text-white/90">
                {formatDuration(clip.durationSec)}
              </span>
            )}
            <span className="text-xs text-white/80 opacity-0 transition-opacity group-hover:opacity-100">
              Open in editor →
            </span>
          </button>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
            Record or open a clip to see it here.
          </div>
        )}
      </div>
    </div>
  );
}
