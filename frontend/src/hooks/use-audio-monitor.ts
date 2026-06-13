import { useEffect, useState } from "react";
import { hasMediaApi } from "@/lib/utils";

/**
 * Live microphone monitor: opens the default mic and exposes AnalyserNodes that
 * the UI can read (on its own rAF) to draw level meters and a waveform.
 *
 * This is intentionally DECOUPLED from the recording pipeline (recording-canvas
 * opens its own mic at record time): the monitor owns a separate stream so the
 * verified recording path is untouched. Both use the SAME constraints (no DSP,
 * stereo, 48k — mirrors AUDIO_SAMPLE_RATE / AUDIO_NUM_CHANNELS in
 * recording-canvas.tsx) so they request identical device settings and the
 * monitor reflects what will actually be recorded.
 */
const MONITOR_SAMPLE_RATE = 48000;
const MONITOR_CHANNELS = 2;

export interface AudioMonitorState {
  /** True once the mic stream + analysers are live. */
  active: boolean;
  /** Non-null if the mic could not be opened. */
  error: string | null;
  /** Per-channel time-domain analysers (left / right) for the level meter. */
  analyserL: AnalyserNode | null;
  analyserR: AnalyserNode | null;
  /** Down-mixed analyser for the waveform display. */
  analyserMix: AnalyserNode | null;
}

const IDLE: AudioMonitorState = {
  active: false,
  error: null,
  analyserL: null,
  analyserR: null,
  analyserMix: null,
};

export function useAudioMonitor(enabled: boolean): AudioMonitorState {
  const [state, setState] = useState<AudioMonitorState>(IDLE);

  useEffect(() => {
    if (!enabled) {
      setState(IDLE);
      return;
    }
    if (!hasMediaApi("getUserMedia")) {
      setState({ ...IDLE, error: "Microphone unavailable in this environment" });
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let removeGestureResume: (() => void) | null = null;

    const teardown = () => {
      removeGestureResume?.();
      removeGestureResume = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      ctx?.close().catch(() => {});
      ctx = null;
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: MONITOR_CHANNELS,
            sampleRate: MONITOR_SAMPLE_RATE,
          },
        });
        if (cancelled) return teardown();

        ctx = new AudioContext({ sampleRate: MONITOR_SAMPLE_RATE });
        if (ctx.sampleRate !== MONITOR_SAMPLE_RATE) {
          console.warn(
            `[AudioMonitor] AudioContext rate clamped to ${ctx.sampleRate}Hz (requested ${MONITOR_SAMPLE_RATE}).`,
          );
        }
        const source = ctx.createMediaStreamSource(stream);

        // WebKit doesn't reliably honor channelCount:2 and most built-in mics
        // are mono, so read back what we actually got (mirrors recording-canvas).
        const settings = stream.getAudioTracks()[0]?.getSettings();
        const channelCount = settings?.channelCount;

        const analyserL = ctx.createAnalyser();
        const analyserR = ctx.createAnalyser();
        for (const a of [analyserL, analyserR]) {
          a.fftSize = 1024;
          a.smoothingTimeConstant = 0;
        }

        if (channelCount === 2) {
          // True stereo: split L/R into separate meters.
          const splitter = ctx.createChannelSplitter(2);
          source.connect(splitter);
          splitter.connect(analyserL, 0);
          splitter.connect(analyserR, 1);
        } else {
          // Mono (or unreported): a mono source through a ChannelSplitter leaves
          // the right output silent, which would show a dead R meter and falsely
          // imply a missing channel. Mirror the real signal to both meters.
          source.connect(analyserL);
          source.connect(analyserR);
          console.warn(
            `[AudioMonitor] Stereo not confirmed (channelCount=${channelCount}); mirroring mono level to both meters.`,
          );
        }

        // Down-mixed analyser for the waveform.
        const analyserMix = ctx.createAnalyser();
        analyserMix.fftSize = 2048;
        analyserMix.smoothingTimeConstant = 0;
        source.connect(analyserMix);

        // Pull the graph without making the mic audible (no feedback). A leaf
        // analyser isn't guaranteed to be processed in every engine, so route
        // the source through a muted gain node to the destination.
        const silent = ctx.createGain();
        silent.gain.value = 0;
        source.connect(silent);
        silent.connect(ctx.destination);

        // AudioContext may start suspended without a user gesture (the monitor
        // can mount on load). Resume now, and once on the next interaction.
        ctx.resume().catch(() => {});
        if (ctx.state === "suspended") {
          const resume = () => ctx?.resume().catch(() => {});
          window.addEventListener("pointerdown", resume, { once: true });
          window.addEventListener("keydown", resume, { once: true });
          removeGestureResume = () => {
            window.removeEventListener("pointerdown", resume);
            window.removeEventListener("keydown", resume);
          };
        }

        if (cancelled) return teardown();
        setState({ active: true, error: null, analyserL, analyserR, analyserMix });
      } catch (e) {
        if (!cancelled) setState({ ...IDLE, error: String(e) });
        teardown();
      }
    })();

    return () => {
      cancelled = true;
      setState(IDLE);
      teardown();
    };
  }, [enabled]);

  return state;
}
