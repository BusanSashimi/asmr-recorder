import { useCallback, useEffect, useRef, useState } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { Play, Pause, Scissors, Loader2, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Input, EncodedPacketSink, EncodedPacket, WrappedCanvas, InputVideoTrack } from "mediabunny";
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

/** A keep-range within the clip (seconds, in < out). */
type Segment = { in: number; out: number };

/**
 * Re-encode frames [inSec, gopEnd) from a video track into a short segment and
 * return the resulting EncodedPackets for splicing into a main lossless output.
 *
 * This lets a frame-accurate cut start at an exact frame rather than the
 * preceding keyframe. Packets are returned with timestamps in original clip-seconds.
 */
async function reencodeLeadingGop(
  mb: typeof import("mediabunny"),
  videoTrack: InputVideoTrack,
  inSec: number,
  gopEnd: number,
): Promise<EncodedPacket[]> {
  const bitrate = (await videoTrack.getAverageBitrate()) ?? 5_000_000;

  const packets: EncodedPacket[] = [];
  const sampleSource = new mb.VideoSampleSource({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    codec: videoTrack.codec as any,
    bitrate,
    keyFrameInterval: Math.max(gopEnd - inSec + 1, 9999),
    onEncodedPacket: (p: EncodedPacket) => { packets.push(p); },
  });

  const miniOutput = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new mb.BufferTarget(),
  });
  miniOutput.addVideoTrack(sampleSource);
  await miniOutput.start();

  const sampleSink = new mb.VideoSampleSink(videoTrack);
  for await (const sample of sampleSink.samples(inSec, gopEnd)) {
    await sampleSource.add(sample);
    sample.close();
  }

  await miniOutput.finalize();
  return packets;
}

/**
 * Losslessly copy N keep-segments from `input` into a single continuous MP4,
 * rebasing timestamps across segments so the output plays without gaps.
 *
 * When `frameAccurate` is true and the H.264 encoder is available, segments
 * whose in-point does not land on a keyframe have their leading partial GOP
 * re-encoded so the cut starts at the exact requested frame. Otherwise the
 * in-point snaps to the preceding keyframe (same as the default lossless path).
 */
async function trimToBuffer(
  input: Input,
  segments: Segment[],
  frameAccurate: boolean,
): Promise<ArrayBuffer> {
  const mb = await import("mediabunny");
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack?.codec) throw new Error("No supported video track found");
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioCodec = audioTrack?.codec ?? null;

  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new mb.BufferTarget(),
  });
  const videoSource = new mb.EncodedVideoPacketSource(videoTrack.codec);
  output.addVideoTrack(videoSource);
  const audioSource = audioCodec
    ? new mb.EncodedAudioPacketSource(audioCodec)
    : null;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();

  const videoMeta = {
    decoderConfig: (await videoTrack.getDecoderConfig()) ?? undefined,
  };
  const audioMeta = audioTrack
    ? { decoderConfig: (await audioTrack.getDecoderConfig()) ?? undefined }
    : null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const canFrameAccurate = frameAccurate && await mb.canEncodeVideo(videoTrack.codec as any);
  if (frameAccurate && !canFrameAccurate) {
    toast({
      title: "Frame-accurate unavailable",
      description: "H.264 encoder not found — using lossless keyframe-snapped cuts.",
    });
  }

  let firstVideo = true;
  let firstAudio = true;
  let timelineOffset = 0; // output timestamp where the next segment begins

  for (const seg of segments) {
    if (seg.out - seg.in < 0.05) continue;

    const videoSink = new mb.EncodedPacketSink(videoTrack);
    const startKey = await videoSink.getKeyPacket(seg.in, { verifyKeyPackets: true });
    if (!startKey) continue;

    const audioSink = audioTrack ? new mb.EncodedPacketSink(audioTrack) : null;
    let audioStart: EncodedPacket | null = null;
    if (audioSink) {
      audioStart = await audioSink.getPacket(startKey.timestamp);
    }

    // origin: earliest clip timestamp emitted for this segment.
    // Audio can start slightly before the video keyframe; use the minimum so
    // neither stream gets a negative rebased timestamp.
    const origin = Math.min(
      startKey.timestamp,
      audioStart?.timestamp ?? startKey.timestamp,
    );

    // segOffset is fixed for this segment so audio and video use the same base.
    const segOffset = timelineOffset;
    let lastVideoEnd = segOffset;

    if (canFrameAccurate && startKey.timestamp < seg.in - 0.001) {
      // Frame-accurate: re-encode the partial GOP [seg.in, gopEnd), then
      // packet-copy [gopEnd, seg.out]. Both halves use seg.in as the reference
      // so they join seamlessly at segOffset + (gopEnd - seg.in).
      const gopEndKey = await videoSink.getNextKeyPacket(startKey);
      const gopEnd = gopEndKey ? gopEndKey.timestamp : seg.out;

      const reencoded = await reencodeLeadingGop(mb, videoTrack, seg.in, gopEnd);
      for (const rp of reencoded) {
        const ts = rp.timestamp - seg.in + segOffset;
        await videoSource.add(
          new mb.EncodedPacket(rp.data, rp.type, ts, rp.duration, rp.sequenceNumber),
          firstVideo ? videoMeta : undefined,
        );
        firstVideo = false;
        lastVideoEnd = ts + rp.duration;
      }

      if (gopEndKey) {
        for await (const p of videoSink.packets(gopEndKey)) {
          if (p.timestamp > seg.out) break;
          const ts = p.timestamp - seg.in + segOffset;
          await videoSource.add(
            new mb.EncodedPacket(p.data, p.type, ts, p.duration, p.sequenceNumber),
            firstVideo ? videoMeta : undefined,
          );
          firstVideo = false;
          lastVideoEnd = ts + p.duration;
        }
      }
    } else {
      // Lossless: packet-copy from the keyframe at/before seg.in.
      for await (const p of videoSink.packets(startKey)) {
        if (p.timestamp > seg.out) break;
        const ts = p.timestamp - origin + segOffset;
        await videoSource.add(
          new mb.EncodedPacket(p.data, p.type, ts, p.duration, p.sequenceNumber),
          firstVideo ? videoMeta : undefined,
        );
        firstVideo = false;
        lastVideoEnd = ts + p.duration;
      }
    }

    timelineOffset = lastVideoEnd; // next segment starts immediately after this one

    // Audio: always lossless packet-copy. Same origin + segOffset as video.
    if (audioSink && audioSource && audioStart && audioMeta) {
      for await (const p of audioSink.packets(audioStart)) {
        if (p.timestamp > seg.out) break;
        await audioSource.add(
          new mb.EncodedPacket(
            p.data,
            p.type,
            p.timestamp - origin + segOffset,
            p.duration,
            p.sequenceNumber,
          ),
          firstAudio ? audioMeta : undefined,
        );
        firstAudio = false;
      }
    }
  }

  await output.finalize();
  return output.target.buffer as ArrayBuffer;
}

/** Renders a mediabunny WrappedCanvas thumbnail as a DOM canvas element. */
function ThumbnailCanvas({
  wc,
  onClick,
}: {
  wc: WrappedCanvas;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.width = wc.canvas.width;
    el.height = wc.canvas.height;
    el.getContext("2d")?.drawImage(wc.canvas, 0, 0);
  }, [wc]);
  return (
    <canvas
      ref={ref}
      onClick={onClick}
      title={`Seek to ${formatTime(wc.timestamp)}`}
      className="h-9 flex-1 cursor-pointer rounded-sm object-cover opacity-80 hover:opacity-100 transition-opacity"
    />
  );
}

/**
 * TrimEditor — opens right after a recording stops, operating on the in-memory
 * MP4 bytes dispatched by RecordingCanvas. Supports:
 *  - Head/tail trimming (lossless, in-point snapped to keyframe)
 *  - Mid-clip removal ("Cut out selection" splits a keep-segment into two)
 *  - Optional frame-accurate cuts (re-encodes the leading partial GOP)
 *  - Thumbnail filmstrip for quick navigation
 */
export function TrimEditor() {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([{ in: 0, out: 0 }]);
  const [activeSegIdx, setActiveSegIdx] = useState(0);
  const [frameAccurate, setFrameAccurate] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [thumbnails, setThumbnails] = useState<WrappedCanvas[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<Input | null>(null);
  const videoSinkRef = useRef<EncodedPacketSink | null>(null);
  const urlRef = useRef<string | null>(null);
  const prevValRef = useRef<[number, number]>([0, 0]);
  const outTouchedRef = useRef(false);

  // Derived from active segment
  const activeSeg = segments[activeSegIdx] ?? { in: 0, out: duration };
  const inPoint = activeSeg.in;
  const outPoint = activeSeg.out;
  const totalKeptDuration = segments.reduce(
    (sum, s) => sum + Math.max(0, s.out - s.in),
    0,
  );

  useEffect(() => {
    const onReady = (event: Event) => {
      const detail = (event as CustomEvent<{ blob: Blob }>).detail;
      if (!detail?.blob) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(detail.blob);
      urlRef.current = url;
      setSegments([{ in: 0, out: 0 }]);
      setActiveSegIdx(0);
      setIsPlaying(false);
      setThumbnails([]);
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

  // Build Mediabunny Input + fetch thumbnails once per blob.
  useEffect(() => {
    if (!blob) return;
    let cancelled = false;

    (async () => {
      const mb = await import("mediabunny");
      if (cancelled) return;

      const input = new mb.Input({
        formats: mb.ALL_FORMATS,
        source: new mb.BlobSource(blob),
      });
      inputRef.current = input;

      const track = await input.getPrimaryVideoTrack();
      if (!track || cancelled) return;

      videoSinkRef.current = new mb.EncodedPacketSink(track);

      // Thumbnail filmstrip: ~12 evenly-spaced frames at 160px wide.
      const clipDur =
        (await input.getDurationFromMetadata()) ??
        (await track.getDurationFromMetadata()) ??
        0;
      if (clipDur > 0 && !cancelled) {
        const count = 12;
        const timestamps = Array.from(
          { length: count },
          (_, i) => ((i + 0.5) * clipDur) / count,
        );
        const canvasSink = new mb.CanvasSink(track, { width: 160 });
        const thumbs: WrappedCanvas[] = [];
        for await (const wc of canvasSink.canvasesAtTimestamps(timestamps)) {
          if (cancelled) break;
          if (wc) thumbs.push(wc);
        }
        if (!cancelled) setThumbnails(thumbs);
      }
    })().catch(() => {
      // errors surfaced at export time
    });

    return () => {
      cancelled = true;
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
    setSegments([{ in: 0, out: 0 }]);
    setActiveSegIdx(0);
    setFrameAccurate(false);
    setIsPlaying(false);
    setIsExporting(false);
    setThumbnails([]);
    outTouchedRef.current = false;
  }, []);

  const adoptDuration = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const dur = Number.isFinite(video.duration) ? video.duration : 0;
    if (dur <= 0) return;
    setDuration(dur);
    if (!outTouchedRef.current) {
      setSegments((prev) =>
        prev.map((s, i) => (i === 0 ? { ...s, out: dur } : s)),
      );
      prevValRef.current = [prevValRef.current[0], dur];
    }
  }, []);

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
      setSegments((prev) =>
        prev.map((s, i) => (i === activeSegIdx ? { in: a, out: b } : s)),
      );
      prevValRef.current = [a, b];
    },
    [activeSegIdx],
  );

  const handleValueCommit = useCallback(
    async ([a, b]: number[]) => {
      const sink = videoSinkRef.current;
      if (!sink) return;
      try {
        const kp = await sink.getKeyPacket(a, { verifyKeyPackets: true });
        const snapped = kp ? kp.timestamp : 0;
        setSegments((prev) =>
          prev.map((s, i) => (i === activeSegIdx ? { ...s, in: snapped } : s)),
        );
        prevValRef.current = [snapped, b];
        const video = videoRef.current;
        if (video) video.currentTime = snapped;
      } catch {
        /* keep unsnapped */
      }
    },
    [activeSegIdx],
  );

  // Remove the range [inPoint, outPoint] from the active segment, splitting it
  // into up to two keep-segments (before and after the cut zone).
  const handleCutSelection = useCallback(() => {
    const seg = segments[activeSegIdx];
    if (!seg) return;
    const MIN_SEG = 0.1; // seconds — don't create segments shorter than this
    const replacements: Segment[] = [];
    if (inPoint - seg.in > MIN_SEG) replacements.push({ in: seg.in, out: inPoint });
    if (seg.out - outPoint > MIN_SEG) replacements.push({ in: outPoint, out: seg.out });
    if (replacements.length === 0) return;

    setSegments((prev) => [
      ...prev.slice(0, activeSegIdx),
      ...replacements,
      ...prev.slice(activeSegIdx + 1),
    ]);
    // Select the first replacement segment and reset the slider.
    setActiveSegIdx(activeSegIdx);
    const first = replacements[0];
    prevValRef.current = [first.in, first.out];
  }, [segments, activeSegIdx, inPoint, outPoint]);

  const handleRemoveSegment = useCallback(
    (i: number) => {
      setSegments((prev) => prev.filter((_, idx) => idx !== i));
      setActiveSegIdx((prev) => Math.max(0, prev > i ? prev - 1 : prev));
    },
    [],
  );

  const handleExport = useCallback(async () => {
    const input = inputRef.current;
    if (!input) return;
    setIsExporting(true);
    try {
      const buffer = await trimToBuffer(input, segments, frameAccurate);
      const savedPath = await invoke<string>("save_media_recording", buffer);
      toast({ title: "Trimmed clip saved", description: savedPath });
      close();
    } catch (error) {
      toast({
        title: "Trim failed",
        description: String(error),
        variant: "destructive",
      });
      setIsExporting(false);
    }
  }, [segments, frameAccurate, close]);

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
            Drag the handles to adjust the active segment. Use &quot;Cut&quot; to
            remove the selected range. The start snaps to the nearest keyframe.
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
          {/* Slider with segment bands */}
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
              {/* Inert bands for non-active keep-segments */}
              {duration > 0 &&
                segments.map((seg, i) =>
                  i !== activeSegIdx ? (
                    <div
                      key={i}
                      className="absolute top-0 h-full bg-primary/40 cursor-pointer hover:bg-primary/60 transition-colors"
                      style={{
                        left: `${(seg.in / duration) * 100}%`,
                        width: `${((seg.out - seg.in) / duration) * 100}%`,
                      }}
                      onClick={() => {
                        setActiveSegIdx(i);
                        prevValRef.current = [seg.in, seg.out];
                      }}
                    />
                  ) : null,
                )}
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

          {/* Thumbnail filmstrip */}
          {thumbnails.length > 0 && (
            <div className="flex gap-0.5">
              {thumbnails.map((wc, i) => (
                <ThumbnailCanvas
                  key={i}
                  wc={wc}
                  onClick={() => {
                    if (videoRef.current) videoRef.current.currentTime = wc.timestamp;
                  }}
                />
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-sm font-mono text-muted-foreground">
            <span>In {formatTime(inPoint)}</span>
            <span>Keeping {formatTime(totalKeptDuration)}</span>
            <span>Out {formatTime(outPoint)}</span>
          </div>

          {/* Active segment selector chips (only shown when multiple segments) */}
          {segments.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {segments.map((seg, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-0.5 text-xs font-mono border cursor-pointer",
                    i === activeSegIdx
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50",
                  )}
                  onClick={() => {
                    setActiveSegIdx(i);
                    prevValRef.current = [seg.in, seg.out];
                  }}
                >
                  {formatTime(seg.in)}–{formatTime(seg.out)}
                  <button
                    className="ml-0.5 opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveSegment(i);
                    }}
                    title="Remove this segment"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex items-center gap-2">
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
            <Button
              variant="outline"
              onClick={handleCutSelection}
              disabled={isExporting || duration === 0 || outPoint - inPoint < 0.1}
              title="Remove the selected range from the clip"
            >
              <Scissors className="h-4 w-4" />
              Cut
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={frameAccurate}
                onChange={(e) => setFrameAccurate(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Frame-accurate
            </label>
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
                disabled={isExporting || totalKeptDuration <= 0}
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Scissors className="h-4 w-4" />
                )}
                Save trimmed clip
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
