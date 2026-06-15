import { Channel, invoke } from "@tauri-apps/api/core";
import { parseAudioChunkHeader, AUDIO_HEADER_BYTES } from "./audio-wire";
export type { AudioChunkHeader } from "./audio-wire";
export { parseAudioChunkHeader } from "./audio-wire";

/**
 * Native system-audio capture streamed from the Rust backend.
 *
 * WKWebView has no navigator.mediaDevices.getDisplayMedia, so the desktop app
 * captures system audio with ScreenCaptureKit and streams raw interleaved f32 PCM
 * over a Tauri Channel. The frontend de-interleaves each chunk and feeds it into
 * the recording AudioContext via an AudioWorkletNode (or ScriptProcessorNode
 * fallback for WKWebView compatibility), connected to the caller-supplied mix
 * destination node.
 *
 * Wire format — 16-byte LE header + interleaved f32 PCM:
 *   bytes 0..4  : u32 sample_rate
 *   bytes 4..6  : u16 channels
 *   bytes 6..8  : u16 reserved
 *   bytes 8..16 : u64 timestamp_ms
 *   bytes 16..  : f32 interleaved PCM (LE) — 4-byte aligned for zero-copy Float32Array view
 */

const WORKLET_PROCESSOR_NAME = "ring-buffer-source";

// Inline AudioWorklet ring-buffer source processor registered via a Blob URL.
// The processor queues per-channel Float32Arrays sent from the main thread and
// drains them into the output block on each process() call (128 frames). Overflow
// (>64 queued chunks) drops the oldest; underflow fills with silence.
const WORKLET_CODE = `
class RingBufferSourceProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._q = [];
    this._off = 0;
    this.port.onmessage = ({ data }) => {
      if (this._q.length < 64) this._q.push(data);
    };
  }
  process(_, outputs) {
    const out = outputs[0];
    if (!out || !out.length) return true;
    const n = out[0].length;
    let w = 0;
    while (w < n && this._q.length > 0) {
      const ch = this._q[0];
      const avail = ch[0].length - this._off;
      const take = Math.min(n - w, avail);
      for (let c = 0; c < out.length; c++) {
        out[c].set(
          ch[Math.min(c, ch.length - 1)].subarray(this._off, this._off + take),
          w,
        );
      }
      w += take;
      this._off += take;
      if (this._off >= ch[0].length) { this._q.shift(); this._off = 0; }
    }
    if (w < n) for (const c of out) c.fill(0, w);
    return true;
  }
}
registerProcessor('ring-buffer-source', RingBufferSourceProcessor);
`;

export interface SystemAudioOptions {
  sampleRate: number;
  channels: number;
  /** Bundle ID to restrict capture to a single app; undefined = whole-system mix. */
  appBundleId?: string;
}

type AudioSourceResult = {
  pushChunk: (channels: Float32Array[]) => void;
  disconnect: () => void;
};

// Per-section node cleanup fns. Keyed by sectionIndex.
const cleanups = new Map<number, () => void>();
// Per-section active stream channels. Neutered on stop to drop the closure.
const streamChannels = new Map<number, Channel<ArrayBuffer>>();

async function buildAudioSource(
  audioCtx: AudioContext,
  numChannels: number,
  destination: AudioNode,
): Promise<AudioSourceResult> {
  // Try AudioWorklet first. WKWebView may or may not support it; check before use.
  if (audioCtx.audioWorklet) {
    try {
      const blob = new Blob([WORKLET_CODE], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const node = new AudioWorkletNode(audioCtx, WORKLET_PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [numChannels],
      });

      // Route to mix destination (recording) and through a zero-gain path to
      // audioCtx.destination to keep the graph rendering.
      node.connect(destination);
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      node.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      console.log("[native-system-audio] AudioWorklet source created");
      return {
        pushChunk: (frames) => node.port.postMessage(frames),
        disconnect: () => { node.disconnect(); silentGain.disconnect(); },
      };
    } catch (e) {
      console.warn(
        "[native-system-audio] AudioWorklet unavailable, falling back to ScriptProcessorNode:",
        e,
      );
    }
  }

  // Fallback: ScriptProcessorNode ring-buffer (established WKWebView-compatible primitive).
  const queue: Float32Array[][] = [];
  let queueOffset = 0;
  let overflowCount = 0;

  // 0 input channels — this node generates audio from the ring buffer, not from a source.
  const scriptNode = audioCtx.createScriptProcessor(4096, 0, numChannels);

  scriptNode.onaudioprocess = (event) => {
    const buf = event.outputBuffer;
    const n = buf.length;
    let written = 0;

    while (written < n && queue.length > 0) {
      const ch = queue[0];
      const avail = ch[0].length - queueOffset;
      const take = Math.min(n - written, avail);
      for (let c = 0; c < numChannels; c++) {
        buf
          .getChannelData(c)
          .set(
            ch[Math.min(c, ch.length - 1)].subarray(
              queueOffset,
              queueOffset + take,
            ),
            written,
          );
      }
      written += take;
      queueOffset += take;
      if (queueOffset >= ch[0].length) {
        queue.shift();
        queueOffset = 0;
      }
    }
    // Remaining frames are already zeroed by the AudioContext on first use.
  };

  // Connect to mix destination (for recording) AND through a silent gain to
  // audioCtx.destination. The second path keeps onaudioprocess firing in WebKit
  // even when the only other consumer is a MediaStreamDestinationNode.
  scriptNode.connect(destination);
  const silentGain = audioCtx.createGain();
  silentGain.gain.value = 0;
  scriptNode.connect(silentGain);
  silentGain.connect(audioCtx.destination);

  console.log("[native-system-audio] ScriptProcessorNode source created");
  return {
    pushChunk: (frames) => {
      if (queue.length < 64) {
        queue.push(frames);
      } else {
        overflowCount++;
        if (overflowCount % 100 === 1) {
          console.warn(
            `[native-system-audio] ring buffer overflow (${overflowCount} total)`,
          );
        }
      }
    },
    disconnect: () => {
      scriptNode.onaudioprocess = null;
      scriptNode.disconnect();
      silentGain.disconnect();
    },
  };
}

/**
 * Start streaming native system audio into `audioCtx`, mixed to `destination`.
 *
 * The system audio node connects ONLY to `destination` (for recording) — never
 * directly to `audioCtx.destination` (speakers). A zero-gain silent path is added
 * to keep the Web Audio graph rendering without speaker feedback.
 *
 * Returns the Channel for the caller to hold (Tauri keeps the onmessage callback
 * alive; the backend stops only when stopNativeSystemAudioStream is called).
 */
export async function startNativeSystemAudioStream(
  sectionIndex: number,
  audioCtx: AudioContext,
  destination: AudioNode,
  opts: SystemAudioOptions,
  signal?: AbortSignal,
): Promise<Channel<ArrayBuffer>> {
  const { sampleRate, channels, appBundleId } = opts;

  const { pushChunk, disconnect } = await buildAudioSource(
    audioCtx,
    channels,
    destination,
  );
  cleanups.set(sectionIndex, disconnect);

  const channel = new Channel<ArrayBuffer>();

  const ack = () =>
    invoke("ack_system_audio_chunk", { sectionIndex }).catch(() => {});

  channel.onmessage = (buf: ArrayBuffer) => {
    const header = parseAudioChunkHeader(buf);
    if (!header) { ack(); return; }
    const chunkChannels = header.channels;
    const numSamples = (buf.byteLength - AUDIO_HEADER_BYTES) / 4;
    const frameCount = Math.floor(numSamples / Math.max(chunkChannels, 1));

    if (frameCount <= 0) {
      ack();
      return;
    }

    // Zero-copy Float32Array view into the PCM payload.
    // Header is 16 bytes (4-byte aligned) so offset 16 is valid for Float32Array.
    const interleaved = new Float32Array(buf, AUDIO_HEADER_BYTES, numSamples);

    // De-interleave into per-channel Float32Arrays.
    const frames: Float32Array[] = [];
    for (let c = 0; c < chunkChannels; c++) {
      const ch = new Float32Array(frameCount);
      for (let f = 0; f < frameCount; f++) {
        ch[f] = interleaved[f * chunkChannels + c];
      }
      frames.push(ch);
    }

    pushChunk(frames);
    ack();
  };

  streamChannels.set(sectionIndex, channel);

  await invoke("start_system_audio_stream", {
    sectionIndex,
    sampleRate,
    channels,
    appBundleId: appBundleId ?? null,
    onChunk: channel,
  });

  // If a stop raced this start, its backend stop may have run before the stream
  // was registered above (no-op), leaving the SCK session orphaned. Now that the
  // backend insert has landed, issue the stop again so it actually tears down.
  if (signal?.aborted) {
    await stopNativeSystemAudioStream(sectionIndex);
  }

  return channel;
}

/** Stop the native system-audio stream for a section and disconnect audio nodes. */
export async function stopNativeSystemAudioStream(
  sectionIndex: number,
): Promise<void> {
  const channel = streamChannels.get(sectionIndex);
  if (channel) {
    channel.onmessage = () => {};
    streamChannels.delete(sectionIndex);
  }
  const disconnect = cleanups.get(sectionIndex);
  if (disconnect) {
    disconnect();
    cleanups.delete(sectionIndex);
  }
  await invoke("stop_system_audio_stream", { sectionIndex }).catch(() => {});
}
