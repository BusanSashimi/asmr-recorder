import {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { hasMediaApi } from "@/lib/utils";
import type { ScreenRegion } from "@/types/recording";

interface SectionSource {
  type: "video" | "canvas" | null;
  element: HTMLVideoElement | HTMLCanvasElement | null;
  region?: ScreenRegion | null;
}

interface RecordingCanvasProps {
  /** Output width in pixels */
  outputWidth: number;
  /** Output height in pixels */
  outputHeight: number;
  /** Target frame rate */
  frameRate: number;
  /** Whether recording is currently active */
  isRecording: boolean;
  /** Callback when a frame fails to send */
  onFrameError?: (error: string) => void;
  /** Section sources (video or canvas elements for each section) */
  sectionSources: [SectionSource, SectionSource, SectionSource, SectionSource];
  /** Optional getter function to get fresh sources on each frame (preferred) */
  getSectionSources?: () => [
    SectionSource,
    SectionSource,
    SectionSource,
    SectionSource,
  ];
  /** Whether to capture microphone audio */
  captureMic: boolean;
  /** Whether to capture system audio */
  captureSystemAudio: boolean;
}

export interface RecordingCanvasRef {
  /** Get the composite canvas element */
  getCanvas: () => HTMLCanvasElement | null;
  /** Force a frame capture (for debugging) */
  captureFrame: () => void;
}

// Scale factor for recording canvas
const RECORDING_SCALE = 1 / 1;

// WebCodecs H.264 Baseline profile
const H264_CODEC = "avc1.42001f";
const VIDEO_BITRATE = 12_000_000;
// Emit a keyframe roughly once per second. A lossless trim can only start the
// cut on a keyframe, so denser keyframes let the post-record editor snap the
// cut-in point close to where the user drags (computed from fps in the loop).
const KEYFRAME_INTERVAL_SECONDS = 1;
// Backpressure: when the WebCodecs encoder has more than this many frames still
// queued, skip the current composite+encode tick so the queue can't grow without
// bound (and the main thread isn't loaded with work the encoder can't keep up with).
const ENCODE_QUEUE_LIMIT = 2;

// Audio encoding constants
// ASMR audio is the priority: capture in stereo (binaural cues) at a high AAC
// bitrate. 256 kbps is negligible next to the 12 Mbps video budget.
const AUDIO_SAMPLE_RATE = 48000;
const AUDIO_NUM_CHANNELS = 2;
const AUDIO_BITRATE = 256_000;
const AAC_CODEC = "mp4a.40.2";

/**
 * Extract the bare AudioSpecificConfig (ASC) from an AAC decoderConfig
 * description.
 *
 * WKWebView/Safari's AudioEncoder emits `decoderConfig.description` as a full
 * MPEG-4 ES_Descriptor, but mp4-muxer wraps whatever it receives in its own
 * DecoderSpecificInfo (esds). Handing it the ES_Descriptor therefore produces a
 * doubly-nested esds whose top-level audioObjectType reads as 0 — no decoder
 * (ffmpeg, CoreAudio/QuickTime) can open the track. We descend the descriptor
 * tree to the DecoderSpecificInfo (tag 0x05) payload so the muxer wraps it once.
 *
 * Chrome already provides the bare ASC (which starts with the audioObjectType
 * bits, not a descriptor tag), so we return null and leave its metadata as-is.
 */
const extractAudioSpecificConfig = (
  description: ArrayBufferView | ArrayBufferLike,
): Uint8Array | null => {
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(
        description.buffer,
        description.byteOffset,
        description.byteLength,
      )
    : new Uint8Array(description);

  // Only wrapped descriptors need fixing; a bare ASC starts with a value < 0x03.
  const first = bytes[0];
  if (first !== 0x03 && first !== 0x04 && first !== 0x05) return null;

  // Read an MPEG-4 "expandable" size (7 bits per byte, high bit = continue).
  const readLen = (buf: Uint8Array, at: number): [number, number] => {
    let size = 0;
    let i = at;
    for (let k = 0; k < 4; k++) {
      const b = buf[i++];
      size = (size << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return [size, i];
  };

  // Find the DecoderSpecificInfo (tag 0x05) payload, descending through
  // ES_Descriptor (0x03) and DecoderConfigDescriptor (0x04).
  const findDsi = (buf: Uint8Array): Uint8Array | null => {
    let i = 0;
    while (i < buf.length) {
      const tag = buf[i++];
      const [size, contentStart] = readLen(buf, i);
      const end = Math.min(contentStart + size, buf.length);
      if (tag === 0x05) return buf.subarray(contentStart, end);
      if (tag === 0x03) {
        // ES_Descriptor: ES_ID(2) + flags(1) + optional fields, then children.
        let p = contentStart + 2;
        const flags = buf[p++];
        if (flags & 0x80) p += 2; // streamDependenceFlag
        if (flags & 0x40) p += 1 + buf[p]; // URL_Flag (length-prefixed string)
        if (flags & 0x20) p += 2; // OCRstreamFlag
        return findDsi(buf.subarray(p, end));
      }
      if (tag === 0x04) {
        // DecoderConfigDescriptor: 13 fixed bytes, then children.
        return findDsi(buf.subarray(contentStart + 13, end));
      }
      i = end; // unknown descriptor — skip
    }
    return null;
  };

  const asc = findDsi(bytes);
  return asc && asc.length > 0 && asc.length < bytes.length ? asc : null;
};

/**
 * RecordingCanvas - Composites 4 section sources into a 2x2 grid and records to MP4
 *
 * Uses WebCodecs API + mp4-muxer for hardware-accelerated H.264 MP4 output.
 * Falls back to MediaRecorder (WebM) if WebCodecs is unavailable.
 */
export const RecordingCanvas = forwardRef<
  RecordingCanvasRef,
  RecordingCanvasProps
>(function RecordingCanvas(
  {
    outputWidth,
    outputHeight,
    frameRate,
    isRecording,
    onFrameError,
    sectionSources,
    getSectionSources,
    captureMic,
    captureSystemAudio,
  },
  ref,
) {
  const sectionWidth = outputWidth / 2;
  const sectionHeight = outputHeight / 2;
  const recordingWidth = Math.floor(outputWidth * RECORDING_SCALE);
  const recordingHeight = Math.floor(outputHeight * RECORDING_SCALE);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const droppedFrameCountRef = useRef<number>(0);
  const recordingStartTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);
  const watchdogIntervalRef = useRef<number | null>(null);
  const sectionSourcesRef = useRef<
    [SectionSource, SectionSource, SectionSource, SectionSource]
  >(sectionSources);
  const getSectionSourcesRef = useRef(getSectionSources);
  const recordingWidthRef = useRef(recordingWidth);
  const recordingHeightRef = useRef(recordingHeight);
  const frameRateRef = useRef(frameRate);
  const onFrameErrorRef = useRef(onFrameError);

  // WebCodecs refs (primary path - produces MP4)
  const videoEncoderRef = useRef<VideoEncoder | null>(null);
  const muxerRef = useRef<Muxer<ArrayBufferTarget> | null>(null);
  const useWebCodecsRef = useRef<boolean>(false);
  const muxedChunkCountRef = useRef<number>(0);

  // MediaRecorder refs (fallback - produces WebM)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Audio recording refs
  const audioEncoderRef = useRef<AudioEncoder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessingCleanupRef = useRef<(() => void) | null>(null);
  const captureMicRef = useRef(captureMic);
  const captureSystemAudioRef = useRef(captureSystemAudio);

  // Update refs when props change
  useEffect(() => {
    sectionSourcesRef.current = sectionSources;
    getSectionSourcesRef.current = getSectionSources;
    recordingWidthRef.current = recordingWidth;
    recordingHeightRef.current = recordingHeight;
    frameRateRef.current = frameRate;
    onFrameErrorRef.current = onFrameError;
    captureMicRef.current = captureMic;
    captureSystemAudioRef.current = captureSystemAudio;
  }, [
    sectionSources,
    getSectionSources,
    recordingWidth,
    recordingHeight,
    frameRate,
    onFrameError,
    captureMic,
    captureSystemAudio,
  ]);

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    captureFrame: () => updateFrame(),
  }));

  /**
   * Draw a single section onto the composite canvas
   */
  const drawSection = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      source: SectionSource,
      destX: number,
      destY: number,
      destWidth: number,
      destHeight: number,
    ) => {
      if (!source.element || source.type === null) {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(destX, destY, destWidth, destHeight);
        return;
      }

      try {
        if (source.type === "video") {
          const video = source.element as HTMLVideoElement;
          if (video.readyState >= video.HAVE_CURRENT_DATA) {
            if (source.region) {
              // Cropped screen capture: draw only the selected region straight
              // from the live source video using the 9-arg source-rect form, so
              // the recording reads the source directly instead of an
              // rAF-driven intermediate canvas (which freezes when the window
              // is occluded and adds a redundant copy).
              const { x, y, width, height } = source.region;
              ctx.drawImage(
                video,
                x,
                y,
                width,
                height,
                destX,
                destY,
                destWidth,
                destHeight,
              );
            } else {
              ctx.drawImage(video, destX, destY, destWidth, destHeight);
            }
          } else {
            if (
              frameCountRef.current < 5 ||
              frameCountRef.current % 50 === 0
            ) {
              console.warn(
                `[RecordingCanvas] Video not ready at frame ${frameCountRef.current}: readyState=${video.readyState}, paused=${video.paused}, ended=${video.ended}, srcObject=${!!video.srcObject}`,
              );
            }
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(destX, destY, destWidth, destHeight);
          }
        } else if (source.type === "canvas") {
          const canvas = source.element as HTMLCanvasElement;
          if (canvas.width > 0 && canvas.height > 0) {
            ctx.drawImage(canvas, destX, destY, destWidth, destHeight);
          } else {
            if (frameCountRef.current < 5) {
              console.warn(
                `[RecordingCanvas] Canvas invalid: ${canvas.width}x${canvas.height}`,
              );
            }
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(destX, destY, destWidth, destHeight);
          }
        }
      } catch (error) {
        if (frameCountRef.current < 5 || frameCountRef.current % 50 === 0) {
          console.error(
            `[RecordingCanvas] Error drawing section at frame ${frameCountRef.current}:`,
            error,
          );
        }
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(destX, destY, destWidth, destHeight);
      }
    },
    [],
  );

  /**
   * Composite all sections onto the canvas
   */
  const compositeFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      if (frameCountRef.current < 3)
        console.warn("[RecordingCanvas] Canvas ref not available");
      return;
    }

    // Create the 2D context once and cache it. We never read pixels back from
    // this canvas (its only consumers are new VideoFrame(canvas) and
    // canvas.captureStream), so we deliberately omit willReadFrequently — in
    // WebKit that flag forces permanent software rasterization. alpha:false
    // keeps the always-opaque composite GPU-backed.
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = canvas.getContext("2d", { alpha: false });
      ctxRef.current = ctx;
    }
    if (!ctx) {
      if (frameCountRef.current < 3)
        console.warn("[RecordingCanvas] Canvas context not available");
      return;
    }

    const currentSources = getSectionSourcesRef.current
      ? getSectionSourcesRef.current()
      : sectionSourcesRef.current;

    if (frameCountRef.current === 0) {
      const sourcesInfo = currentSources
        .map((s, i) => {
          if (s.type === "video" && s.element) {
            const video = s.element as HTMLVideoElement;
            return `[${i}] VIDEO: ready=${video.readyState}, paused=${video.paused}, hasStream=${!!video.srcObject}`;
          } else if (s.type === "canvas" && s.element) {
            const canvas = s.element as HTMLCanvasElement;
            return `[${i}] CANVAS: ${canvas.width}x${canvas.height}`;
          } else {
            return `[${i}] EMPTY`;
          }
        })
        .join(", ");
      console.log(`[RecordingCanvas] Section sources: ${sourcesInfo}`);
    }

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, outputWidth, outputHeight);

    // 2x2 grid layout
    drawSection(ctx, currentSources[0], 0, 0, sectionWidth, sectionHeight);
    drawSection(
      ctx,
      currentSources[1],
      sectionWidth,
      0,
      sectionWidth,
      sectionHeight,
    );
    drawSection(
      ctx,
      currentSources[2],
      0,
      sectionHeight,
      sectionWidth,
      sectionHeight,
    );
    drawSection(
      ctx,
      currentSources[3],
      sectionWidth,
      sectionHeight,
      sectionWidth,
      sectionHeight,
    );

    // Grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sectionWidth, 0);
    ctx.lineTo(sectionWidth, outputHeight);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, sectionHeight);
    ctx.lineTo(outputWidth, sectionHeight);
    ctx.stroke();
  }, [outputWidth, outputHeight, sectionWidth, sectionHeight, drawSection]);

  /**
   * Save recording data to the Tauri backend
   */
  const saveRecording = useCallback(
    async (data: ArrayBuffer) => {
      try {
        // Send bytes as the raw IPC body (Tauri v2) instead of base64, so long
        // recordings don't hit the JS max-string-length limit.
        const savedPath = await invoke<string>("save_media_recording", data);

        console.log(`[Recording] Video saved: ${savedPath}`);
        window.dispatchEvent(
          new CustomEvent("recordingSaved", { detail: { path: savedPath } }),
        );
      } catch (error) {
        console.error("[Recording] Error saving video:", error);
        onFrameErrorRef.current?.(String(error));
      }
    },
    [],
  );

  /**
   * Acquire a single mixed audio track from mic and/or system audio sources.
   * Returns null if no audio could be acquired.
   */
  const acquireAudioTrack = useCallback(
    async (
      wantMic: boolean,
      wantSystemAudio: boolean,
    ): Promise<MediaStreamTrack | null> => {
      const audioStreams: MediaStream[] = [];

      if (wantMic && !hasMediaApi("getUserMedia")) {
        console.warn(
          "[Audio] Microphone unavailable: navigator.mediaDevices.getUserMedia is missing in this webview.",
        );
      } else if (wantMic) {
        try {
          // ASMR: disable the browser DSP that destroys quiet textures.
          // Caveats verified against WebKit/macOS: echoCancellation:false drives
          // the processing chain (and effectively noiseSuppression), but
          // autoGainControl is NOT honored as a standalone constraint and
          // channelCount is unreliable — so we read back getSettings() below and
          // warn about anything the platform silently kept on.
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: AUDIO_NUM_CHANNELS,
              sampleRate: AUDIO_SAMPLE_RATE,
            },
          });
          audioStreams.push(micStream);

          const settings = micStream.getAudioTracks()[0]?.getSettings();
          console.log("[Audio] Microphone stream acquired:", settings);
          if (
            settings &&
            (settings.echoCancellation ||
              settings.noiseSuppression ||
              settings.autoGainControl)
          ) {
            console.warn(
              "[Audio] DSP still active despite constraints (WebKit may ignore some):",
              {
                echoCancellation: settings.echoCancellation,
                noiseSuppression: settings.noiseSuppression,
                autoGainControl: settings.autoGainControl,
              },
            );
          }
          if (
            settings?.channelCount &&
            settings.channelCount < AUDIO_NUM_CHANNELS
          ) {
            console.warn(
              `[Audio] Mic delivered ${settings.channelCount} channel(s); ` +
                "recording will be dual-mono, not true stereo " +
                "(WebKit may ignore the channelCount constraint).",
            );
          }
        } catch (error) {
          console.warn("[Audio] Failed to acquire microphone:", error);
        }
      }

      if (wantSystemAudio && !hasMediaApi("getDisplayMedia")) {
        console.warn(
          "[Audio] System audio unavailable: navigator.mediaDevices.getDisplayMedia is missing in this webview.",
        );
      } else if (wantSystemAudio) {
        try {
          const sysStream = await navigator.mediaDevices.getDisplayMedia({
            video: { width: 1, height: 1 },
            audio: true,
          });
          sysStream.getVideoTracks().forEach((t) => t.stop());
          audioStreams.push(sysStream);
          console.log("[Audio] System audio stream acquired");
        } catch (error) {
          console.warn("[Audio] Failed to acquire system audio:", error);
        }
      }

      if (audioStreams.length === 0) return null;

      if (audioStreams.length === 1) {
        const track = audioStreams[0].getAudioTracks()[0] || null;
        audioStreamRef.current = new MediaStream(
          audioStreams.flatMap((s) => s.getAudioTracks()),
        );
        return track;
      }

      const audioContext = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      audioContextRef.current = audioContext;
      const destination = audioContext.createMediaStreamDestination();

      for (const stream of audioStreams) {
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(destination);
      }

      audioStreamRef.current = new MediaStream([
        ...audioStreams.flatMap((s) => s.getAudioTracks()),
        ...destination.stream.getAudioTracks(),
      ]);

      return destination.stream.getAudioTracks()[0] || null;
    },
    [],
  );

  /**
   * Get the recording AudioContext, creating it at the preferred sample rate if
   * one isn't already live (acquireAudioTrack creates one for multi-stream
   * mixing). WebKit may clamp the requested rate to the hardware rate, so
   * callers must read the returned context's actual `sampleRate` and configure
   * the encoder + muxer to match — that one rate keeps the AudioData, AAC
   * config, and mp4a/esds boxes coherent (a mismatch yields a pitch-skewed or
   * undecodable track).
   */
  const ensureAudioContext = useCallback(() => {
    let audioCtx = audioContextRef.current;
    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE });
      audioContextRef.current = audioCtx;
    }
    return audioCtx;
  }, []);

  /**
   * Capture raw audio samples from a MediaStreamTrack using Web Audio API
   * (ScriptProcessorNode) and feed AudioData frames into the AudioEncoder.
   *
   * Uses ScriptProcessorNode instead of MediaStreamTrackProcessor for
   * WebKit/WKWebView compatibility (Tauri on macOS).
   */
  const startAudioProcessing = useCallback(
    (audioTrack: MediaStreamTrack, audioEncoder: AudioEncoder) => {
      try {
        // Force stereo (AUDIO_NUM_CHANNELS): the ScriptProcessorNode below is
        // created with this channel count so inputBuffer.numberOfChannels
        // always matches the encoder/muxer config (mono mics are upmixed).
        const channelCount = AUDIO_NUM_CHANNELS;

        // Reuse the AudioContext established by initializeWebCodecs (or the
        // multi-stream mixing context from acquireAudioTrack). Its actual sample
        // rate is what the encoder + muxer were configured with, so we must NOT
        // recreate it here — recreating could re-clamp to a different rate and
        // desync the AudioData from the encoder (pitch-skew / undecodable track).
        const audioCtx = ensureAudioContext();

        const source = audioCtx.createMediaStreamSource(
          new MediaStream([audioTrack]),
        );

        const bufferSize = 4096;
        const scriptNode = audioCtx.createScriptProcessor(
          bufferSize,
          channelCount,
          channelCount,
        );

        let sampleOffset = 0;

        scriptNode.onaudioprocess = (event) => {
          if (audioEncoder.state !== "configured") return;

          const inputBuffer = event.inputBuffer;
          const numChannels = inputBuffer.numberOfChannels;
          const numFrames = inputBuffer.length;

          // Build planar Float32 data: [ch0_all_samples, ch1_all_samples, ...]
          const planarData = new Float32Array(numFrames * numChannels);
          for (let ch = 0; ch < numChannels; ch++) {
            planarData.set(inputBuffer.getChannelData(ch), ch * numFrames);
          }

          const timestampUs =
            (sampleOffset / inputBuffer.sampleRate) * 1_000_000;

          try {
            const audioData = new AudioData({
              format: "f32-planar",
              sampleRate: inputBuffer.sampleRate,
              numberOfFrames: numFrames,
              numberOfChannels: numChannels,
              timestamp: timestampUs,
              data: planarData,
            });
            audioEncoder.encode(audioData);
            audioData.close();
          } catch (error) {
            console.error("[Audio] Failed to encode audio frame:", error);
          }

          sampleOffset += numFrames;
        };

        // Connect: source -> scriptProcessor -> silent gain -> destination
        // The node must be connected to destination for onaudioprocess to fire
        const silentGain = audioCtx.createGain();
        silentGain.gain.value = 0;

        source.connect(scriptNode);
        scriptNode.connect(silentGain);
        silentGain.connect(audioCtx.destination);

        audioProcessingCleanupRef.current = () => {
          scriptNode.onaudioprocess = null;
          source.disconnect();
          scriptNode.disconnect();
          silentGain.disconnect();
        };

        console.log(
          `[Audio] Started audio processing: ${channelCount}ch @ ${audioCtx.sampleRate}Hz, buffer=${bufferSize}`,
        );
      } catch (error) {
        console.warn("[Audio] Failed to start audio processing:", error);
      }
    },
    [ensureAudioContext],
  );

  /**
   * Initialize WebCodecs VideoEncoder + MP4 muxer (primary path)
   * Returns true if initialization succeeded.
   */
  const initializeWebCodecs = useCallback(
    (
      width: number,
      height: number,
      fps: number,
      audioTrack?: MediaStreamTrack | null,
    ): boolean => {
      if (typeof VideoEncoder === "undefined") return false;

      // Declared outside the try so the outer catch (the WebM fallback, which a
      // VIDEO failure triggers) can close an already-configured audio encoder —
      // otherwise resolving audio before video below would orphan it.
      let audioEncoder: AudioEncoder | null = null;

      try {
        // Resolve audio BEFORE building the muxer/encoder so the AudioContext's
        // actual sample rate (WebKit may clamp the requested 48k to the hardware
        // rate) drives both the AAC encoder AND the muxer's mp4a/esds boxes,
        // keeping the AudioData, encoder, and container coherent. Audio setup is
        // isolated in its own try: if it fails we record a video-only MP4 rather
        // than tearing the whole (verified) WebCodecs path down into a WebM
        // fallback.
        let audioSampleRate = AUDIO_SAMPLE_RATE;
        if (audioTrack) {
          try {
            audioSampleRate = ensureAudioContext().sampleRate;
            if (audioSampleRate !== AUDIO_SAMPLE_RATE) {
              console.warn(
                `[WebCodecs] AudioContext clamped to ${audioSampleRate}Hz (requested ${AUDIO_SAMPLE_RATE}); configuring encoder + muxer to match.`,
              );
            }

            audioEncoder = new AudioEncoder({
              // Fires during encoding, after `muxer` below has been assigned.
              output: (chunk, metadata) => {
                try {
                  // WKWebView/Safari hands a full ES_Descriptor as the
                  // description; pass mp4-muxer the bare ASC so the esds isn't
                  // double-wrapped (which makes the audio track undecodable).
                  const dc = metadata?.decoderConfig;
                  const asc = dc?.description
                    ? extractAudioSpecificConfig(dc.description)
                    : null;
                  if (dc && asc) {
                    muxer.addAudioChunk(chunk, {
                      ...metadata,
                      decoderConfig: { ...dc, description: asc },
                    });
                  } else {
                    muxer.addAudioChunk(chunk, metadata);
                  }
                } catch (error) {
                  console.error(
                    "[WebCodecs] Failed to mux audio chunk:",
                    error,
                  );
                }
              },
              error: (error) => {
                console.error("[AudioEncoder] Error:", error);
              },
            });

            // WebKit's AAC encoder defaults to VBR, which treats `bitrate` as a
            // loose ceiling and encodes quiet ASMR content far below it (~80-130k
            // observed vs the 256k requested). Request CBR so the configured rate
            // is actually used; fall back to the default mode if CBR is rejected.
            const baseAudioConfig: AudioEncoderConfig = {
              codec: AAC_CODEC,
              numberOfChannels: AUDIO_NUM_CHANNELS,
              sampleRate: audioSampleRate,
              bitrate: AUDIO_BITRATE,
            };
            try {
              audioEncoder.configure({
                ...baseAudioConfig,
                bitrateMode: "constant",
              });
            } catch (cbrError) {
              console.warn(
                "[WebCodecs] CBR audio config rejected; using default bitrate mode:",
                cbrError,
              );
              audioEncoder.configure(baseAudioConfig);
            }
          } catch (audioError) {
            // An audio-only failure must not kill the (verified) video path.
            console.warn(
              "[WebCodecs] Audio setup failed; recording video-only MP4:",
              audioError,
            );
            try {
              audioEncoder?.close();
            } catch {
              /* encoder may be unconfigured; ignore */
            }
            audioEncoder = null;
          }
        }
        const hasAudio = audioEncoder !== null;

        const target = new ArrayBufferTarget();

        const muxer = new Muxer({
          target,
          video: { codec: "avc", width, height },
          ...(hasAudio && {
            audio: {
              codec: "aac" as const,
              numberOfChannels: AUDIO_NUM_CHANNELS,
              sampleRate: audioSampleRate,
            },
          }),
          fastStart: "in-memory",
          firstTimestampBehavior: "offset",
        });

        const encoder = new VideoEncoder({
          output: (chunk, metadata) => {
            try {
              muxer.addVideoChunk(chunk, metadata);
              muxedChunkCountRef.current++;
            } catch (error) {
              console.error("[WebCodecs] Failed to mux video chunk:", error);
            }
          },
          error: (error) => {
            console.error("[WebCodecs] Encoder error:", error);
            onFrameErrorRef.current?.(String(error));
          },
        });

        encoder.configure({
          codec: H264_CODEC,
          width,
          height,
          framerate: fps,
          bitrate: VIDEO_BITRATE,
          hardwareAcceleration: "prefer-hardware",
          latencyMode: "realtime",
        });

        if (audioEncoder && audioTrack) {
          audioEncoderRef.current = audioEncoder;
          startAudioProcessing(audioTrack, audioEncoder);
          console.log(
            `[WebCodecs] Audio encoder initialized: ${AUDIO_NUM_CHANNELS}ch @ ${audioSampleRate}Hz`,
          );
        }

        videoEncoderRef.current = encoder;
        muxerRef.current = muxer;
        useWebCodecsRef.current = true;
        muxedChunkCountRef.current = 0;

        console.log(
          `[WebCodecs] Initialized: ${width}x${height} @ ${fps}fps, H.264 -> MP4${hasAudio ? " + AAC audio" : ""}`,
        );
        return true;
      } catch (error) {
        console.warn(
          "[WebCodecs] Failed to initialize, falling back to MediaRecorder:",
          error,
        );
        // A video failure can land here after the audio encoder was already
        // configured; close it so it isn't orphaned (audioEncoderRef may not be
        // assigned yet, so teardown wouldn't catch it).
        try {
          audioEncoder?.close();
        } catch {
          /* may be unconfigured/closed; ignore */
        }
        videoEncoderRef.current = null;
        audioEncoderRef.current = null;
        muxerRef.current = null;
        useWebCodecsRef.current = false;
        return false;
      }
    },
    [startAudioProcessing, ensureAudioContext],
  );

  /**
   * Initialize MediaRecorder (fallback for browsers without WebCodecs)
   */
  const initializeMediaRecorder = useCallback(
    (
      canvas: HTMLCanvasElement,
      width: number,
      height: number,
      fps: number,
    ) => {
      const stream = canvas.captureStream(fps);
      recordedChunksRef.current = [];

      let mimeType = "video/webm;codecs=vp9";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "video/webm;codecs=h264";
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = "video/webm;codecs=vp8";
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = "video/webm";
          }
        }
      }

      console.log(`[MediaRecorder] Fallback codec: ${mimeType}`);

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITRATE,
      });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        console.log(
          `[MediaRecorder] Recording stopped, ${recordedChunksRef.current.length} chunks collected`,
        );
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        console.log(`[MediaRecorder] Final video size: ${blob.size} bytes`);
        const buffer = await blob.arrayBuffer();
        await saveRecording(buffer);
      };

      recorder.onerror = (event) => {
        console.error("[MediaRecorder] Recording error:", event);
        onFrameErrorRef.current?.("MediaRecorder error");
      };

      mediaRecorderRef.current = recorder;
      useWebCodecsRef.current = false;
      console.log(
        `[MediaRecorder] Initialized: ${width}x${height} @ ${fps}fps`,
      );
    },
    [saveRecording],
  );

  /**
   * Composite a frame and encode it.
   * WebCodecs: creates a VideoFrame and encodes per-frame.
   * MediaRecorder: captures from canvas stream automatically.
   */
  const updateFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const perfStart = performance.now();
    // Mark loop liveness on EVERY tick (including skipped backpressure ticks)
    // so the watchdog tracks "is the frame loop running", not "did we encode" —
    // otherwise sustained intentional dropping would trip false stall warnings.
    lastFrameTimeRef.current = perfStart;

    try {
      // Backpressure: if the hardware encoder is falling behind, skip this tick
      // (composite + encode) so VideoFrames can't queue without bound and stall
      // the main thread. Only applies to WebCodecs — MediaRecorder samples the
      // canvas via captureStream and exposes no queue to inspect.
      const encoder = videoEncoderRef.current;
      if (
        useWebCodecsRef.current &&
        encoder &&
        encoder.encodeQueueSize > ENCODE_QUEUE_LIMIT
      ) {
        droppedFrameCountRef.current++;
        return;
      }

      compositeFrame();
      const compositeTime = performance.now() - perfStart;

      // WebCodecs: create VideoFrame from canvas and encode
      if (useWebCodecsRef.current && encoder) {
        if (encoder.state === "configured") {
          const timestampUs =
            (performance.now() - recordingStartTimeRef.current) * 1000;
          const frameDurationUs = 1_000_000 / frameRateRef.current;
          const videoFrame = new VideoFrame(canvas, {
            timestamp: timestampUs,
            duration: frameDurationUs,
          });
          const keyframeIntervalFrames = Math.max(
            1,
            Math.round(frameRateRef.current * KEYFRAME_INTERVAL_SECONDS),
          );
          const isKeyFrame =
            frameCountRef.current % keyframeIntervalFrames === 0;
          encoder.encode(videoFrame, { keyFrame: isKeyFrame });
          videoFrame.close();
        }
      }

      frameCountRef.current++;

      if (frameCountRef.current % 30 === 0) {
        const elapsed =
          (performance.now() - recordingStartTimeRef.current) / 1000;
        const fps = frameCountRef.current / elapsed;
        const method = useWebCodecsRef.current
          ? "WebCodecs/MP4"
          : "MediaRecorder/WebM";
        console.log(
          `[RecordingCanvas-${method}] Frame ${frameCountRef.current}: ` +
            `composite=${compositeTime.toFixed(1)}ms, ` +
            `fps=${fps.toFixed(1)}, ` +
            `elapsed=${elapsed.toFixed(1)}s, ` +
            `dropped=${droppedFrameCountRef.current}`,
        );
      }
    } catch (error) {
      console.error(
        `[RecordingCanvas] Failed to process frame ${frameCountRef.current}:`,
        error,
      );
      onFrameErrorRef.current?.(String(error));
    }
  }, [compositeFrame]);

  // Start/stop recording based on recording state
  useEffect(() => {
    if (!isRecording) {
      return;
    }

    let cancelled = false;

    const startRecording = async () => {
      try {
        console.log(`[RecordingCanvas] Starting recording session`);
        recordingStartTimeRef.current = performance.now();
        frameCountRef.current = 0;
        droppedFrameCountRef.current = 0;
        lastFrameTimeRef.current = performance.now();

        const canvas = canvasRef.current;
        if (!canvas) throw new Error("Canvas not available");

        const width = recordingWidthRef.current;
        const height = recordingHeightRef.current;
        const fps = frameRateRef.current;

        // Acquire audio track if mic or system audio is enabled
        const audioTrack = await acquireAudioTrack(
          captureMicRef.current,
          captureSystemAudioRef.current,
        );

        if (cancelled) {
          if (audioTrack) audioTrack.stop();
          return;
        }

        // Try WebCodecs first (MP4 output), fall back to MediaRecorder (WebM)
        const webCodecsReady = initializeWebCodecs(
          width,
          height,
          fps,
          audioTrack,
        );
        if (!webCodecsReady) {
          initializeMediaRecorder(canvas, width, height, fps);
          const recorder = mediaRecorderRef.current;
          if (!recorder) throw new Error("MediaRecorder not initialized");
          recorder.start(1000);
        }

        if (cancelled) return;

        const method = useWebCodecsRef.current
          ? "WebCodecs/MP4"
          : "MediaRecorder/WebM";
        console.log(
          `[RecordingCanvas] Recording started (${method}): ${width}x${height} @ ${fps}fps${audioTrack ? " + audio" : ""}`,
        );

        // Composite frames at the target frame rate
        const intervalMs = 1000 / fps;
        frameIntervalRef.current = window.setInterval(() => {
          try {
            updateFrame();
          } catch (error) {
            console.error(
              `[RecordingCanvas] Error in frame loop at frame ${frameCountRef.current}:`,
              error,
            );
          }
        }, intervalMs);

        // Watchdog to detect stalls
        watchdogIntervalRef.current = window.setInterval(() => {
          const timeSinceLastFrame =
            performance.now() - lastFrameTimeRef.current;
          const expectedInterval = 1000 / frameRateRef.current;

          if (timeSinceLastFrame > expectedInterval * 3) {
            console.warn(
              `[RecordingCanvas] WATCHDOG: No frame in ${(timeSinceLastFrame / 1000).toFixed(1)}s! ` +
                `Last frame: ${frameCountRef.current}`,
            );
          }
        }, 1000);
      } catch (error) {
        console.error("[RecordingCanvas] Failed to start recording:", error);
        onFrameErrorRef.current?.(String(error));
      }
    };

    startRecording();

    // Cleanup on stop
    return () => {
      cancelled = true;
      console.log(`[RecordingCanvas] Cleanup - stopping recording`);

      if (frameIntervalRef.current !== null) {
        clearInterval(frameIntervalRef.current);
        frameIntervalRef.current = null;
      }
      if (watchdogIntervalRef.current !== null) {
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
      }

      // Stop audio processing (disconnect ScriptProcessorNode)
      if (audioProcessingCleanupRef.current) {
        audioProcessingCleanupRef.current();
        audioProcessingCleanupRef.current = null;
      }

      // Snapshot the recording method before clearing refs
      const wasUsingWebCodecs = useWebCodecsRef.current;

      if (wasUsingWebCodecs) {
        // Finalize WebCodecs encoders and muxer, then save MP4
        const videoEncoder = videoEncoderRef.current;
        const audioEncoder = audioEncoderRef.current;
        const muxer = muxerRef.current;
        if (videoEncoder && muxer) {
          (async () => {
            try {
              await videoEncoder.flush();
              videoEncoder.close();

              if (audioEncoder && audioEncoder.state === "configured") {
                await audioEncoder.flush();
                audioEncoder.close();
              }

              if (muxedChunkCountRef.current === 0) {
                console.warn(
                  "[WebCodecs] No video chunks were successfully muxed, skipping finalization",
                );
                return;
              }

              muxer.finalize();
              const mp4Buffer = muxer.target.buffer;
              // Copy the bytes for the trim editor before saveRecording reads
              // them. Only this WebCodecs/MP4 path emits the edit event — the
              // MediaRecorder/WebM fallback doesn't — so the editor only ever
              // opens for a seekable MP4.
              const editBlob = new Blob([mp4Buffer], { type: "video/mp4" });
              console.log(
                `[WebCodecs] MP4 finalized: ${mp4Buffer.byteLength} bytes (${muxedChunkCountRef.current} chunks)`,
              );
              await saveRecording(mp4Buffer);
              window.dispatchEvent(
                new CustomEvent("recordingReadyForEdit", {
                  detail: { blob: editBlob },
                }),
              );
            } catch (error) {
              console.error(
                "[WebCodecs] Error finalizing recording:",
                error,
              );
              onFrameErrorRef.current?.(String(error));
            }
          })();
        }
        videoEncoderRef.current = null;
        audioEncoderRef.current = null;
        muxerRef.current = null;
      } else {
        // Stop MediaRecorder (triggers onstop handler which saves the file)
        if (
          mediaRecorderRef.current &&
          mediaRecorderRef.current.state !== "inactive"
        ) {
          try {
            mediaRecorderRef.current.stop();
            console.log("[RecordingCanvas] MediaRecorder stopped");
          } catch (error) {
            console.error(
              "[RecordingCanvas] Error stopping MediaRecorder:",
              error,
            );
          }
        }
      }

      // Release audio resources
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }

      useWebCodecsRef.current = false;

      const elapsed =
        (performance.now() - recordingStartTimeRef.current) / 1000;
      console.log(
        `[RecordingCanvas] Session ended: ${frameCountRef.current} frames, ${elapsed.toFixed(1)}s elapsed`,
      );
    };
  }, [
    isRecording,
    acquireAudioTrack,
    initializeWebCodecs,
    initializeMediaRecorder,
    updateFrame,
    saveRecording,
  ]);

  // Set canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = outputWidth;
      canvas.height = outputHeight;
    }
  }, [outputWidth, outputHeight]);

  return (
    <canvas
      ref={canvasRef}
      width={outputWidth}
      height={outputHeight}
      className="hidden"
      aria-hidden="true"
    />
  );
});
