export type BuildSoundSelectionMode = "sequential" | "shuffle";

export interface BuildSoundSettings {
  enabled: boolean;
  monitoredUrl: string;
  monitoredPort: number;
  selectionMode: BuildSoundSelectionMode;
  volume: number;
  orderedSoundbiteIds: string[];
}

export interface SoundbiteMetadata {
  id: string;
  displayName: string;
  mimeType: string;
  byteSize: number;
  duration: number;
  createdAt: number;
  available: boolean;
}

export interface DecodedSoundbite extends SoundbiteMetadata {
  buffer: AudioBuffer;
}

export interface BuildBridgeStatus {
  state: "waiting" | "connected";
  projectId: string | null;
  projectName: string | null;
  actualPort: number | null;
  lastHeartbeat: number | null;
  lastEvent: number | null;
}

export interface BuildSuccessEvent {
  projectId: string;
  projectName: string;
  actualPort: number;
  eventId: string;
  eventType: "hmr" | "full-reload";
  timestamp: number;
}

export interface BuildSoundState {
  settings: BuildSoundSettings;
  soundbites: SoundbiteMetadata[];
  bridgeStatus: BuildBridgeStatus;
}

export const defaultBuildSoundSettings: BuildSoundSettings = {
  enabled: false,
  monitoredUrl: "http://localhost:5174",
  monitoredPort: 5174,
  selectionMode: "sequential",
  volume: 70,
  orderedSoundbiteIds: [],
};

export const defaultBuildBridgeStatus: BuildBridgeStatus = {
  state: "waiting",
  projectId: null,
  projectName: null,
  actualPort: null,
  lastHeartbeat: null,
  lastEvent: null,
};
