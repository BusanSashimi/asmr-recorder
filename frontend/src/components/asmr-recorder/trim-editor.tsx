import { useCallback, useEffect, useRef, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Play, Pause, Scissors, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  Input,
  Output,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
  ALL_FORMATS,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  EncodedAudioPacketSource,
  EncodedPacket,
} from "mediabunny";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

/** mm:ss.t */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const t = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${t}`;
}

/**
 * Losslessly trim [inSec, outSec] out of the recorded MP4 by copying encoded
 * packets — no decode/re-encode. The cut start is snapped down to the keyframe
 * at/before inSec (a stream copy can only begin on a keyframe). Returns the new
 * MP4 bytes. avc1.42001f is Constrained Baseline (no B-frames), so ending the
 * tail on any frame is safe.
 */
async function trimToBuffer(
  input: Input,
  inSec: number,
  outSec: number,
): Promise<ArrayBuffer> {
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack?.codec) throw new Error("No supported video track found");
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioCodec = audioTrack?.codec ?? null;

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const videoSource = new EncodedVideoPacketSource(videoTrack.codec);
  output.addVideoTrack(videoSource);
  const audioSource = audioCodec
    ? new EncodedAudioPacketSource(audioCodec)
    : null;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();

  const videoSink = new EncodedPacketSink(videoTrack);
  const startKey = await videoSink.getKeyPacket(inSec, {
    verifyKeyPackets: true,
  });
  if (!startKey) throw new Error("No keyframe found at the cut-in point");

  // Re-base every packet so the earliest emitted packet sits at t=0. The audio
  // packet covering the start can begin slightly before the video keyframe, so
  // use the minimum of the two as the origin to keep A/V aligned and avoid
  // negative timestamps (which the muxer rejects).
  let origin = startKey.timestamp;
  const audioSink = audioTrack ? new EncodedPacketSink(audioTrack) : null;
  let audioStart: EncodedPacket | null = null;
  if (audioSink) {
    audioStart = await audioSink.getPacket(startKey.timestamp);
    if (audioStart) origin = Math.min(origin, audioStart.timestamp);
  }

  const videoMeta = {
    decoderConfig: (await videoTrack.getDecoderConfig()) ?? undefined,
  };
  let firstVideo = true;
  for await (const p of videoSink.packets(startKey)) {
    if (p.timestamp > outSec) break;
    await videoSource.add(
      new EncodedPacket(
        p.data,
        p.type,
        p.timestamp - origin,
        p.duration,
        p.sequenceNumber,
      ),
      firstVideo ? videoMeta : undefined,
    );
    firstVideo = false;
  }

  if (audioSink && audioSource && audioStart) {
    const audioMeta = {
      decoderConfig: (await audioTrack!.getDecoderConfig()) ?? undefined,
    };
    let firstAudio = true;
    for await (const p of audioSink.packets(audioStart)) {
      if (p.timestamp > outSec) break;
      await audioSource.add(
        new EncodedPacket(
          p.data,
          p.type,
          p.timestamp - origin,
          p.duration,
          p.sequenceNumber,
        ),
        firstAudio ? audioMeta : undefined,
      );
      firstAudio = false;
    }
  }

  await output.finalize();
  return output.target.buffer as ArrayBuffer;
}

/**
 * TrimEditor — opens right after a recording stops, operating on the in-memory
 * MP4 bytes dispatched by RecordingCanvas (no disk read-back). Lets the user
 * drag in/out handles and save a losslessly trimmed copy. The original auto-save
 * is untouched, so trimming is non-destructive.
 */
export function TrimEditor() {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [inPoint, setInPoint] = useState(0);
  const [outPoint, setOutPoint] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<Input | null>(null);
  const videoSinkRef = useRef<EncodedPacketSink | null>(null);
  const urlRef = useRef<string | null>(null);
  // Last [in, out] applied to the slider, to detect which thumb the user moved.
  const prevValRef = useRef<[number, number]>([0, 0]);
  // Whether the user has moved the out handle, so a late duration update (WKWebView
  // often revises video.duration after loadedmetadata) doesn't clobber their choice.
  const outTouchedRef = useRef(false);

  // Listen for a finished recording handed off by RecordingCanvas. The object
  // URL is created here (not in an effect) so we never call setState inside an
  // effect body; it's revoked on close and on unmount.
  useEffect(() => {
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<{ blob: Blob }>).detail;
      if (!detail?.blob) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(detail.blob);
      urlRef.current = url;
      // Reset edit state for the new clip (a recording can finish while a prior
      // one is still open in the editor).
      setInPoint(0);
      setOutPoint(0);
      setIsPlaying(false);
      outTouchedRef.current = false;
      prevValRef.current = [0, 0];
      setVideoUrl(url);
      setBlob(detail.blob);
    };
    window.addEventListener("recordingReadyForEdit", onReady);
    return () => {
      window.removeEventListener("recordingReadyForEdit", onReady);
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  // Build a Mediabunny Input from the blob for keyframe lookups + export.
  useEffect(() => {
    if (!blob) return;
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob),
    });
    inputRef.current = input;
    input
      .getPrimaryVideoTrack()
      .then((track) => {
        if (track) videoSinkRef.current = new EncodedPacketSink(track);
      })
      .catch(() => {
        /* validity is surfaced at export time */
      });

    return () => {
      inputRef.current = null;
      videoSinkRef.current = null;
    };
  }, [blob]);

  const close = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setBlob(null);
    setVideoUrl(null);
    setDuration(0);
    setInPoint(0);
    setOutPoint(0);
    setIsPlaying(false);
    setIsExporting(false);
    outTouchedRef.current = false;
  }, []);

  // Adopt a known duration from the <video> (loadedmetadata, or a later
  // durationchange — WKWebView frequently reports 0/Infinity first). Extend the
  // out point to the full clip unless the user has already moved it.
  const adoptDuration = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    if (dur <= 0) return;
    setDuration(dur);
    if (!outTouchedRef.current) {
      setOutPoint(dur);
      prevValRef.current = [prevValRef.current[0], dur];
    }
  }, []);

  // Keep preview playback inside the selected range.
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime >= outPoint) {
      video.pause();
      video.currentTime = outPoint;
      setIsPlaying(false);
    }
  }, [outPoint]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      if (video.currentTime < inPoint || video.currentTime >= outPoint) {
        video.currentTime = inPoint;
      }
      video.play();
      setIsPlaying(true);
    }
  }, [isPlaying, inPoint, outPoint]);

  // Live drag: move state and seek the preview to whichever handle moved.
  const handleValueChange = useCallback(
    ([a, b]: number[]) => {
      const [prevA, prevB] = prevValRef.current;
      const movedOut = Math.abs(b - prevB) > Math.abs(a - prevA);
      if (b !== prevB) outTouchedRef.current = true;
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.currentTime = movedOut ? b : a;
        setIsPlaying(false);
      }
      setInPoint(a);
      setOutPoint(b);
      prevValRef.current = [a, b];
    },
    [],
  );

  // On release, snap the in-point down to the real keyframe so the lossless
  // export starts exactly where the preview shows.
  const handleValueCommit = useCallback(async ([a, b]: number[]) => {
    const sink = videoSinkRef.current;
    if (!sink) return;
    try {
      const kp = await sink.getKeyPacket(a, { verifyKeyPackets: true });
      const snapped = kp ? kp.timestamp : 0;
      setInPoint(snapped);
      prevValRef.current = [snapped, b];
      const video = videoRef.current;
      if (video) video.currentTime = snapped;
    } catch {
      /* keep the unsnapped value; export will still snap */
    }
  }, []);

  const handleExport = useCallback(async () => {
    const input = inputRef.current;
    if (!input) return;
    setIsExporting(true);
    try {
      const buffer = await trimToBuffer(input, inPoint, outPoint);
      // Raw bytes as the IPC body (no base64) — see save_media_recording.
      const savedPath = await invoke<string>("save_media_recording", buffer);
      toast({
        title: "Trimmed clip saved",
        description: savedPath,
      });
      close();
    } catch (error) {
      toast({
        title: "Trim failed",
        description: String(error),
        variant: "destructive",
      });
      setIsExporting(false);
    }
  }, [inPoint, outPoint, close]);

  const trimmedDuration = Math.max(0, outPoint - inPoint);

  return (
    <Dialog
      open={!!blob}
      onOpenChange={(open) => {
        if (!open && !isExporting) close();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Trim recording</DialogTitle>
          <DialogDescription>
            Drag the handles to set the start and end. The clip is cut losslessly
            — the start snaps to the nearest keyframe.
          </DialogDescription>
        </DialogHeader>

        {videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            onLoadedMetadata={adoptDuration}
            onDurationChange={adoptDuration}
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setIsPlaying(false)}
            className="w-full rounded-md bg-black aspect-video"
            playsInline
          />
        )}

        <div className="space-y-3">
          <SliderPrimitive.Root
            className="relative flex w-full touch-none select-none items-center"
            min={0}
            max={duration || 1}
            step={0.05}
            minStepsBetweenThumbs={1}
            value={[inPoint, outPoint]}
            onValueChange={handleValueChange}
            onValueCommit={handleValueCommit}
            disabled={isExporting || duration === 0}
          >
            <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
              <SliderPrimitive.Range className="absolute h-full bg-primary" />
            </SliderPrimitive.Track>
            {[0, 1].map((i) => (
              <SliderPrimitive.Thumb
                key={i}
                className={cn(
                  "block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
              />
            ))}
          </SliderPrimitive.Root>

          <div className="flex items-center justify-between text-sm font-mono text-muted-foreground">
            <span>In {formatTime(inPoint)}</span>
            <span>Keeping {formatTime(trimmedDuration)}</span>
            <span>Out {formatTime(outPoint)}</span>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="secondary"
            onClick={togglePlay}
            disabled={!videoUrl || isExporting}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Preview
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={close}
              disabled={isExporting}
            >
              Skip
            </Button>
            <Button
              onClick={handleExport}
              disabled={isExporting || trimmedDuration <= 0}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Scissors className="h-4 w-4" />
              )}
              Save trimmed clip
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
