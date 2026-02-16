// Recording configuration types matching the Rust backend

export type PipPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type VideoQuality = "low" | "medium" | "high";

// Output resolution presets (all 16:9 aspect ratio)
export type OutputResolution = "hd720" | "hd1080" | "qhd1440" | "uhd4k";

export const OUTPUT_RESOLUTIONS: Record<OutputResolution, { width: number; height: number; label: string }> = {
  hd720: { width: 1280, height: 720, label: "720p (1280×720)" },
  hd1080: { width: 1920, height: 1080, label: "1080p (1920×1080)" },
  qhd1440: { width: 2560, height: 1440, label: "1440p (2560×1440)" },
  uhd4k: { width: 3840, height: 2160, label: "4K (3840×2160)" },
};

export interface RecordingConfig {
  captureScreen: boolean;
  captureWebcam: boolean;
  webcamPosition: PipPosition;
  webcamSize: number;
  captureMic: boolean;
  captureSystemAudio: boolean;
  outputPath?: string;
  videoQuality: VideoQuality;
  frameRate?: number;
  outputResolution: OutputResolution;
}

export interface RecordingStatus {
  isRecording: boolean;
  durationMs: number;
  frameCount: number;
  outputPath?: string;
  error?: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
}

export interface DeviceList {
  screens: DeviceInfo[];
  webcams: DeviceInfo[];
  microphones: DeviceInfo[];
  hasSystemAudio: boolean;
}

export const defaultRecordingConfig: RecordingConfig = {
  captureScreen: true,
  captureWebcam: false,
  webcamPosition: "top-right",
  webcamSize: 25,
  captureMic: true,
  captureSystemAudio: false,
  videoQuality: "medium",
  frameRate: 30,
  outputResolution: "hd1080",
};

/**
 * Configuration for external frame recording (frames sent from frontend)
 * Used when recording the composite preview canvas instead of native capture
 */
export interface ExternalRecordingConfig {
  /** Whether to capture microphone audio */
  captureMic: boolean;
  /** Whether to capture system audio */
  captureSystemAudio: boolean;
  /** Output file path (optional, will generate if not provided) */
  outputPath?: string;
  /** Video quality preset */
  videoQuality: VideoQuality;
  /** Target frame rate (default 30) */
  frameRate?: number;
  /** Output resolution preset */
  outputResolution: OutputResolution;
  /** Output width in pixels (must match frames sent from frontend) */
  outputWidth: number;
  /** Output height in pixels (must match frames sent from frontend) */
  outputHeight: number;
}

export const defaultExternalRecordingConfig: ExternalRecordingConfig = {
  captureMic: true,
  captureSystemAudio: false,
  videoQuality: "medium",
  frameRate: 60,
  outputResolution: "qhd1440",
  outputWidth: 2560,
  outputHeight: 1440,
};

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

// Section-based recording types
export type RecordingSource = "screen" | "camera" | null;

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SectionConfig {
  source: RecordingSource;
  deviceId?: string;      // Camera device ID if source is "camera"
  deviceName?: string;    // Human-readable device name
  region?: ScreenRegion;  // Screen region if source is "screen"
  stream?: MediaStream;   // Live MediaStream for preview
}

export interface SectionState {
  sections: [SectionConfig, SectionConfig, SectionConfig, SectionConfig];
  activeSectionIndex: number | null;
}

export const defaultSectionConfig: SectionConfig = {
  source: null,
};

export const defaultSectionState: SectionState = {
  sections: [
    { source: null },
    { source: null },
    { source: null },
    { source: null },
  ],
  activeSectionIndex: null,
};
