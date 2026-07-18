import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { validateSoundbite } from "@/lib/soundbite-validation";
import type {
  BuildBridgeStatus,
  BuildSoundSettings,
  BuildSoundState,
  BuildSuccessEvent,
  DecodedSoundbite,
  SoundbiteMetadata,
} from "@/types/build-sounds";
import {
  defaultBuildBridgeStatus,
  defaultBuildSoundSettings,
} from "@/types/build-sounds";

type BuildSuccessListener = (event: BuildSuccessEvent) => void;

interface ImportResult {
  imported: number;
  errors: string[];
}

interface BuildSoundContextValue {
  settings: BuildSoundSettings;
  soundbites: SoundbiteMetadata[];
  playableSoundbites: DecodedSoundbite[];
  bridgeStatus: BuildBridgeStatus;
  loading: boolean;
  updateSettings: (updates: Partial<BuildSoundSettings>) => Promise<void>;
  importFiles: (files: File[]) => Promise<ImportResult>;
  deleteSoundbite: (id: string) => Promise<void>;
  moveSoundbite: (id: string, direction: -1 | 1) => Promise<void>;
  previewSoundbite: (id: string) => Promise<void>;
  subscribeBuildSuccess: (listener: BuildSuccessListener) => () => void;
}

const BuildSoundContext = createContext<BuildSoundContextValue | null>(null);

function rawBytes(value: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}

export function BuildSoundProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultBuildSoundSettings);
  const [soundbites, setSoundbites] = useState<SoundbiteMetadata[]>([]);
  const [decoded, setDecoded] = useState<Map<string, AudioBuffer>>(new Map());
  const [bridgeStatus, setBridgeStatus] = useState(defaultBuildBridgeStatus);
  const [loading, setLoading] = useState(true);
  const settingsRef = useRef(settings);
  const soundbitesRef = useRef(soundbites);
  const settingsWriteRef = useRef<Promise<void>>(Promise.resolve());
  const listenersRef = useRef(new Set<BuildSuccessListener>());
  const previewRef = useRef<{
    context: AudioContext;
    source: AudioBufferSourceNode;
  } | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    soundbitesRef.current = soundbites;
  }, [soundbites]);

  useEffect(() => {
    let cancelled = false;
    const unlisten: Array<() => void> = [];

    const load = async () => {
      if (!isTauri()) {
        setLoading(false);
        return;
      }
      try {
        const state = await invoke<BuildSoundState>("get_build_sound_state");
        if (cancelled) return;
        settingsRef.current = state.settings;
        soundbitesRef.current = state.soundbites;
        setSettings(state.settings);
        setSoundbites(state.soundbites);
        setBridgeStatus(state.bridgeStatus);

        const audioContext = new AudioContext();
        const nextDecoded = new Map<string, AudioBuffer>();
        for (const metadata of state.soundbites) {
          if (!metadata.available || cancelled) continue;
          try {
            const raw = await invoke<ArrayBuffer | Uint8Array>("read_soundbite", {
              id: metadata.id,
            });
            const buffer = await audioContext.decodeAudioData(rawBytes(raw).slice(0));
            if (buffer.duration > 0 && buffer.duration <= 30) {
              nextDecoded.set(metadata.id, buffer);
            } else {
              throw new Error("Stored soundbite duration is invalid");
            }
          } catch (error) {
            console.warn(
              `[BuildSounds] Stored clip ${metadata.displayName} is unavailable:`,
              error,
            );
            void invoke("set_soundbite_availability", {
              id: metadata.id,
              available: false,
            });
          }
        }
        await audioContext.close().catch(() => undefined);
        if (!cancelled) {
          setDecoded(nextDecoded);
          setSoundbites((items) =>
            items.map((item) => ({
              ...item,
              available: item.available && nextDecoded.has(item.id),
            })),
          );
          if (nextDecoded.size === 0) {
            const disabled = { ...settingsRef.current, enabled: false };
            settingsRef.current = disabled;
            setSettings(disabled);
          }
        }
      } catch (error) {
        console.error("[BuildSounds] Failed to load state:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    if (isTauri()) {
      void listen<BuildBridgeStatus>(
        "build-sound://bridge-status",
        ({ payload }) => setBridgeStatus(payload),
      ).then((dispose) => {
        if (cancelled) dispose();
        else unlisten.push(dispose);
      });
      void listen<BuildSuccessEvent>(
        "build-sound://build-success",
        ({ payload }) => {
          setBridgeStatus((status) => ({
            ...status,
            lastEvent: payload.timestamp,
          }));
          listenersRef.current.forEach((listener) => listener(payload));
        },
      ).then((dispose) => {
        if (cancelled) dispose();
        else unlisten.push(dispose);
      });
    }

    return () => {
      cancelled = true;
      unlisten.forEach((dispose) => dispose());
      if (previewRef.current) {
        try {
          previewRef.current.source.stop();
        } catch {
          // Already ended.
        }
        void previewRef.current.context.close();
        previewRef.current = null;
      }
    };
  }, []);

  const updateSettings = useCallback(
    async (updates: Partial<BuildSoundSettings>) => {
      const hasPlayable = [...decoded.keys()].length > 0;
      const previous = settingsRef.current;
      const next = {
        ...previous,
        ...updates,
        enabled:
          updates.enabled === true && !hasPlayable
            ? false
            : (updates.enabled ?? settingsRef.current.enabled),
      };
      settingsRef.current = next;
      setSettings(next);
      if (!isTauri()) return;
      try {
        let saved: BuildSoundSettings | undefined;
        const write = settingsWriteRef.current
          .catch(() => undefined)
          .then(async () => {
            saved = await invoke<BuildSoundSettings>(
              "update_build_sound_settings",
              { settings: next },
            );
          });
        settingsWriteRef.current = write;
        await write;
        if (saved && settingsRef.current === next) {
          settingsRef.current = saved;
          setSettings(saved);
        }
      } catch (error) {
        if (settingsRef.current === next) {
          settingsRef.current = previous;
          setSettings(previous);
        }
        throw new Error(String(error));
      }
    },
    [decoded],
  );

  const importFiles = useCallback(async (files: File[]): Promise<ImportResult> => {
    const result: ImportResult = { imported: 0, errors: [] };
    if (files.length === 0) return result;
    const context = new AudioContext();
    try {
      for (const file of files) {
        try {
          const validated = await validateSoundbite(
            file,
            (bytes) => context.decodeAudioData(bytes),
          );
          if (!isTauri()) {
            throw new Error("Soundbite import is available in the desktop app");
          }
          const metadata = await invoke<SoundbiteMetadata>(
            "import_soundbite",
            validated.bytes,
            {
              headers: {
                "x-soundbite-name": encodeURIComponent(file.name),
                "x-soundbite-mime": file.type,
                "x-soundbite-duration": String(validated.buffer.duration),
              },
            },
          );
          setDecoded((current) => {
            const next = new Map(current);
            next.set(metadata.id, validated.buffer);
            return next;
          });
          setSoundbites((current) => [...current, metadata]);
          soundbitesRef.current = [...soundbitesRef.current, metadata];
          const nextSettings = {
            ...settingsRef.current,
            orderedSoundbiteIds: [
              ...settingsRef.current.orderedSoundbiteIds,
              metadata.id,
            ],
          };
          settingsRef.current = nextSettings;
          setSettings(nextSettings);
          result.imported++;
        } catch (error) {
          result.errors.push(String(error).replace(/^Error:\s*/, ""));
        }
      }
    } finally {
      await context.close().catch(() => undefined);
    }
    return result;
  }, []);

  const deleteSoundbite = useCallback(async (id: string) => {
    if (isTauri()) await invoke("delete_soundbite", { id });
    setDecoded((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
    const remaining = soundbitesRef.current.filter((item) => item.id !== id);
    soundbitesRef.current = remaining;
    setSoundbites(remaining);
    const nextSettings = {
      ...settingsRef.current,
      enabled:
        remaining.some((item) => item.available) && settingsRef.current.enabled,
      orderedSoundbiteIds: settingsRef.current.orderedSoundbiteIds.filter(
        (item) => item !== id,
      ),
    };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
  }, []);

  const moveSoundbite = useCallback(async (id: string, direction: -1 | 1) => {
    const order = [...settingsRef.current.orderedSoundbiteIds];
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    await updateSettings({ orderedSoundbiteIds: order });
  }, [updateSettings]);

  const previewSoundbite = useCallback(
    async (id: string) => {
      const buffer = decoded.get(id);
      if (!buffer) throw new Error("This soundbite is unavailable");
      if (previewRef.current) {
        try {
          previewRef.current.source.stop();
        } catch {
          // Already ended.
        }
        await previewRef.current.context.close().catch(() => undefined);
      }
      const context = new AudioContext();
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = settingsRef.current.volume / 100;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(context.destination);
      previewRef.current = { context, source };
      source.onended = () => {
        if (previewRef.current?.source === source) {
          void context.close();
          previewRef.current = null;
        }
      };
      source.start();
    },
    [decoded],
  );

  const subscribeBuildSuccess = useCallback((listener: BuildSuccessListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const playableSoundbites = useMemo(() => {
    const byId = new Map(soundbites.map((item) => [item.id, item]));
    return settings.orderedSoundbiteIds.flatMap((id) => {
      const metadata = byId.get(id);
      const buffer = decoded.get(id);
      return metadata?.available && buffer ? [{ ...metadata, buffer }] : [];
    });
  }, [decoded, settings.orderedSoundbiteIds, soundbites]);

  const value = useMemo<BuildSoundContextValue>(
    () => ({
      settings,
      soundbites,
      playableSoundbites,
      bridgeStatus,
      loading,
      updateSettings,
      importFiles,
      deleteSoundbite,
      moveSoundbite,
      previewSoundbite,
      subscribeBuildSuccess,
    }),
    [
      settings,
      soundbites,
      playableSoundbites,
      bridgeStatus,
      loading,
      updateSettings,
      importFiles,
      deleteSoundbite,
      moveSoundbite,
      previewSoundbite,
      subscribeBuildSuccess,
    ],
  );

  return (
    <BuildSoundContext.Provider value={value}>
      {children}
    </BuildSoundContext.Provider>
  );
}

// Context hooks intentionally live beside their provider, matching the app's
// existing recording-context convention.
// eslint-disable-next-line react-refresh/only-export-components
export function useBuildSounds() {
  const context = useContext(BuildSoundContext);
  if (!context) {
    throw new Error("useBuildSounds must be used inside BuildSoundProvider");
  }
  return context;
}
