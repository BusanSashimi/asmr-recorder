import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import {
  startNativeSystemAudioStream,
  stopNativeSystemAudioStream,
} from "@/lib/native-system-audio";
import type { AudioMonitorState } from "./use-audio-monitor";

const MONITOR_SECTION = 99; // reserved index — never used by recording (section 0)
const MONITOR_SAMPLE_RATE = 48000;
const MONITOR_CHANNELS = 2;

const IDLE: AudioMonitorState = {
  active: false,
  error: null,
  analyserL: null,
  analyserR: null,
  analyserMix: null,
};

/**
 * Live system-audio monitor via ScreenCaptureKit.
 *
 * Tauri-only (returns IDLE in a plain browser). Starts an SCK stream on the
 * reserved section index 99 and routes PCM through AnalyserNodes — never to
 * speakers (zero-gain sink). Caller must gate `enabled` off while recording
 * to avoid two concurrent SCK streams.
 */
export function useSystemAudioMonitor(
  enabled: boolean,
  appBundleId?: string,
): AudioMonitorState {
  const [state, setState] = useState<AudioMonitorState>(IDLE);

  useEffect(() => {
    if (!enabled || !isTauri()) {
      setState(IDLE);
      return;
    }

    let cancelled = false;
    let ctx: AudioContext | null = null;

    const teardown = () => {
      stopNativeSystemAudioStream(MONITOR_SECTION);
      ctx?.close().catch(() => {});
      ctx = null;
    };

    (async () => {
      try {
        ctx = new AudioContext({ sampleRate: MONITOR_SAMPLE_RATE });

        // `analyserInput` is the destination for the SCK stream worklet.
        // buildAudioSource already adds worklet → silentGain(0) → ctx.destination
        // to keep the worklet rendered. We add analyserInput → silentOut(0) →
        // ctx.destination so analyserInput is also on the render path and the
        // leaf analysers below receive audio.
        const analyserInput = ctx.createGain();

        await startNativeSystemAudioStream(
          MONITOR_SECTION,
          ctx,
          analyserInput,
          {
            sampleRate: ctx.sampleRate,
            channels: MONITOR_CHANNELS,
            appBundleId,
          },
        );

        if (cancelled) return teardown();

        // Analysers — mirror the shape of use-audio-monitor.ts so the same
        // StereoMeter component can be used for both.
        const analyserL = ctx.createAnalyser();
        const analyserR = ctx.createAnalyser();
        for (const a of [analyserL, analyserR]) {
          a.fftSize = 1024;
          a.smoothingTimeConstant = 0;
        }
        const analyserMix = ctx.createAnalyser();
        analyserMix.fftSize = 2048;
        analyserMix.smoothingTimeConstant = 0.8;
        analyserMix.minDecibels = -90;
        analyserMix.maxDecibels = -30;

        const splitter = ctx.createChannelSplitter(2);
        analyserInput.connect(splitter);
        splitter.connect(analyserL, 0);
        splitter.connect(analyserR, 1);
        analyserInput.connect(analyserMix);

        // Required: path from analyserInput to ctx.destination so the graph
        // renders analyserInput (and therefore its leaf analysers receive audio).
        const silentOut = ctx.createGain();
        silentOut.gain.value = 0;
        analyserInput.connect(silentOut);
        silentOut.connect(ctx.destination);

        ctx.resume().catch(() => {});

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
  }, [enabled, appBundleId]);

  return state;
}
