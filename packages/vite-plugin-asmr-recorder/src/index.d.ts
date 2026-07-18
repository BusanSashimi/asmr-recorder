import type { Plugin } from "vite";

export interface BuildSoundMonitorOptions {
  /** Override ASMR Recorder's platform app-data discovery file. */
  discoveryFile?: string;
}

export default function buildSoundMonitor(
  options?: BuildSoundMonitorOptions,
): Plugin;
