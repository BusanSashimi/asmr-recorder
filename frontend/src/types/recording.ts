// Recording configuration types matching the Rust backend

export type PipPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export type VideoQuality = "low" | "medium" | "high";

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
