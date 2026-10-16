export type Integer = string;
export type Params = Record<string, unknown>;
export interface Command {
  id: string;
  label: string;
  menu: string[];
  shortcut: string | null;
  params: string;
  enabled: boolean;
  reason: string | null;
}
export type ParameterValue = {
  Path?: {
    closed: boolean;
    vertices: {
      p: { x: number; y: number };
      t_in?: { x: number; y: number };
      t_out?: { x: number; y: number };
    }[];
  };
  Float?: number;
  Choice?: string;
  Bool?: boolean;
  Text?: string;
  Vec2?: { x: number; y: number };
  Color?: number[];
  Curve?: number[][];
};
export interface Keyframe {
  time: Integer;
  value: ParameterValue;
  interp: string;
  in_influence: number;
  out_influence: number;
}
export interface Parameter {
  value: ParameterValue;
  keyframes?: Keyframe[];
}
export interface Effect {
  effect: string;
  enabled: boolean;
  params: Record<string, Parameter>;
}
export interface ParameterDefinition {
  id: string;
  label: string;
  kind:
    | string
    | {
        Float?: {
          min: number;
          max: number;
          soft_min: number;
          soft_max: number;
          unit: string;
          decimals: string;
        };
        Choice?: string[];
        Curve?: { hue: boolean };
      };
  default: ParameterValue;
  animatable: boolean;
  group: string | null;
}
export interface EffectDefinition {
  id: string;
  name: string;
  kind: string;
  category: string[];
  intrinsic: boolean;
  params: ParameterDefinition[];
}
export interface Clip {
  id: Integer;
  item: Integer;
  name: string;
  start: Integer;
  duration: Integer;
  source_in: Integer;
  speed: number;
  reverse: boolean;
  audio_stream?: Integer;
  enabled: boolean;
  link?: Integer;
  gain_db: number;
  effects: Effect[];
}
export interface Track {
  id: Integer;
  name: string;
  kind: string;
  items: Clip[];
  locked: boolean;
  muted: boolean;
  enabled: boolean;
  solo: boolean;
  sync_lock: boolean;
  volume_db: number;
  pan: number;
  transitions: {
    id: Integer;
    start: Integer;
    duration: Integer;
    effect: Effect;
  }[];
}
export interface Sequence {
  settings: {
    drop_frame: boolean;
    width: Integer;
    height: Integer;
    frame_rate: { num: Integer; den: Integer };
    sample_rate: Integer;
  };
  video_tracks: Track[];
  audio_tracks: Track[];
  caption_tracks: {
    id: Integer;
    name: string;
    captions: {
      id: Integer;
      text: string;
      start: Integer;
      duration: Integer;
    }[];
  }[];
  markers: { id: Integer; name: string; start: Integer; duration: Integer }[];
  mark_in: Integer | null;
  mark_out: Integer | null;
}
export interface MediaBin {
  id: Integer;
  name: string;
  children: ({ Item: Integer } | { Bin: MediaBin })[];
}
export interface MediaItem {
  id: Integer;
  name: string;
  kind: {
    Sequence?: Sequence;
    Media?: {
      proxy?: { File?: { path: string } };
      source: { File?: { path: string } };
      info: {
        duration: Integer;
        video?: { width: Integer; height: Integer };
        audio?: unknown;
      };
    };
    [key: string]: unknown;
  };
}
export interface EditorSnapshot {
  revision: Integer;
  dirty: boolean;
  path: string | null;
  project: { name: string; root: MediaBin; items: Record<string, MediaItem> };
  state: {
    active_sequence: Integer | null;
    selection: Integer[];
    edit_points: {
      clip: Integer;
      out: boolean;
      kind: "trim" | "ripple" | "roll";
    }[];
    project_selection: Integer[];
    source_item: Integer | null;
    playheads: Record<string, Integer>;
    snapping: boolean;
    linked_selection: boolean;
  };
  sequence: Sequence | null;
  duration: Integer | null;
  source: {
    item: Integer;
    media: Integer;
    start: Integer;
    end: Integer;
    playhead: Integer;
    rate: { num: Integer; den: Integer };
    fps: number;
    markIn: Integer | null;
    markOut: Integer | null;
  } | null;
  voiceover: boolean;
  commands: Command[];
  jobs: {
    id: Integer;
    label: string;
    progress: number;
    etaSeconds: number | null;
    status: string;
    finished: boolean;
    result: unknown;
  }[];
  history: { undo: string[]; redo: string[] };
  recovery: { id: string; name?: string; path?: string }[];
}
