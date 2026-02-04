import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultRecordingConfig, defaultSectionState, defaultExternalRecordingConfig, OUTPUT_RESOLUTIONS } from "@/types/recording";
import type { 
  RecordingConfig, 
  RecordingStatus, 
  DeviceList, 
  SectionConfig, 
  SectionState,
  RecordingSource,
  ExternalRecordingConfig 
} from "@/types/recording";

interface RecordingContextValue {
  config: RecordingConfig;
  updateConfig: (updates: Partial<RecordingConfig>) => void;
  status: RecordingStatus;
  devices: DeviceList | null;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string>;
  fetchDevices: () => Promise<void>;
  // Section-based recording
  sectionState: SectionState;
  setActiveSectionIndex: (index: number | null) => void;
  setSectionSource: (index: number, source: RecordingSource, deviceId?: string, deviceName?: string) => void;
  setSectionStream: (index: number, stream: MediaStream | undefined) => void;
  clearSection: (index: number) => void;
  clearAllSections: () => void;
  browserDevices: MediaDeviceInfo[];
  fetchBrowserDevices: () => Promise<void>;
  // External frame recording (frontend compositing)
  externalConfig: ExternalRecordingConfig;
  updateExternalConfig: (updates: Partial<ExternalRecordingConfig>) => void;
  isExternalRecording: boolean;
  startExternalRecording: () => Promise<void>;
  stopExternalRecording: () => Promise<string>;
}

const RecordingContext = createContext<RecordingContextValue | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<RecordingConfig>(defaultRecordingConfig);
  const [status, setStatus] = useState<RecordingStatus>({
    isRecording: false,
    durationMs: 0,
    frameCount: 0,
  });
  const [devices, setDevices] = useState<DeviceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusPollRef = useRef<number | null>(null);
  
  // Section-based recording state
  const [sectionState, setSectionState] = useState<SectionState>(defaultSectionState);
  const [browserDevices, setBrowserDevices] = useState<MediaDeviceInfo[]>([]);

  // External frame recording state
  const [externalConfig, setExternalConfig] = useState<ExternalRecordingConfig>(defaultExternalRecordingConfig);
  const [isExternalRecording, setIsExternalRecording] = useState(false);

  // Fetch available devices from Tauri backend
  const fetchDevices = useCallback(async () => {
    try {
      const deviceList = await invoke<DeviceList>("get_available_devices");
      setDevices(deviceList);
    } catch (err) {
      console.error("Failed to fetch devices:", err);
      setError(String(err));
    }
  }, []);

  // Fetch browser media devices (cameras, microphones)
  const fetchBrowserDevices = useCallback(async () => {
    try {
      // Request permission first to get full device info
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop());
      }).catch(() => {
        // Permission denied, continue with limited device info
      });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      setBrowserDevices(devices);
    } catch (err) {
      console.error("Failed to fetch browser devices:", err);
    }
  }, []);

  // Fetch devices on mount
  useEffect(() => {
    fetchDevices();
    fetchBrowserDevices();
  }, [fetchDevices, fetchBrowserDevices]);

  // Poll recording status when recording (native or external)
  useEffect(() => {
    const isRecordingActive = status.isRecording || isExternalRecording;
    
    if (isRecordingActive) {
      statusPollRef.current = window.setInterval(async () => {
        try {
          // Use appropriate status endpoint based on recording mode
          const statusCommand = isExternalRecording 
            ? "get_external_recording_status" 
            : "get_recording_status_live";
          const newStatus = await invoke<RecordingStatus>(statusCommand);
          setStatus(newStatus);
        } catch (err) {
          console.error("Failed to fetch status:", err);
        }
      }, 500);
    } else {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
    }

    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
      }
    };
  }, [status.isRecording, isExternalRecording]);

  // Start recording
  const startRecording = useCallback(async () => {
    setError(null);
    try {
      await invoke("start_recording", { config });
      setStatus((prev) => ({ ...prev, isRecording: true }));
    } catch (err) {
      const errorMessage = String(err);
      setError(errorMessage);
      throw err;
    }
  }, [config]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    setError(null);
    try {
      const outputPath = await invoke<string>("stop_recording");
      setStatus((prev) => ({
        ...prev,
        isRecording: false,
        outputPath,
      }));
      return outputPath;
    } catch (err) {
      const errorMessage = String(err);
      setError(errorMessage);
      throw err;
    }
  }, []);

  // Update config
  const updateConfig = useCallback((updates: Partial<RecordingConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  // Update external recording config
  const updateExternalConfig = useCallback((updates: Partial<ExternalRecordingConfig>) => {
    setExternalConfig((prev) => {
      const newConfig = { ...prev, ...updates };
      // Auto-update dimensions when resolution changes
      if (updates.outputResolution) {
        const { width, height } = OUTPUT_RESOLUTIONS[updates.outputResolution];
        newConfig.outputWidth = width;
        newConfig.outputHeight = height;
      }
      return newConfig;
    });
  }, []);

  // Scale factor for recording (must match RECORDING_SCALE in recording-canvas.tsx)
  const RECORDING_SCALE = 1 / 4;

  // Start external frame recording
  const startExternalRecording = useCallback(async () => {
    setError(null);
    try {
      // Apply scale factor to dimensions for frame recording
      const scaledConfig = {
        ...externalConfig,
        outputWidth: Math.round(externalConfig.outputWidth * RECORDING_SCALE),
        outputHeight: Math.round(externalConfig.outputHeight * RECORDING_SCALE),
      };
      await invoke("start_external_recording", { config: scaledConfig });
      setIsExternalRecording(true);
      setStatus((prev) => ({ ...prev, isRecording: true, durationMs: 0, frameCount: 0 }));
    } catch (err) {
      const errorMessage = String(err);
      setError(errorMessage);
      throw err;
    }
  }, [externalConfig]);

  // Stop external frame recording
  const stopExternalRecording = useCallback(async () => {
    setError(null);
    try {
      const outputPath = await invoke<string>("stop_external_recording");
      setIsExternalRecording(false);
      setStatus((prev) => ({
        ...prev,
        isRecording: false,
        outputPath,
      }));
      return outputPath;
    } catch (err) {
      const errorMessage = String(err);
      setError(errorMessage);
      throw err;
    }
  }, []);

  // Section management methods
  const setActiveSectionIndex = useCallback((index: number | null) => {
    setSectionState((prev) => ({
      ...prev,
      activeSectionIndex: index,
    }));
  }, []);

  const setSectionSource = useCallback((
    index: number, 
    source: RecordingSource, 
    deviceId?: string, 
    deviceName?: string
  ) => {
    setSectionState((prev) => {
      const newSections = [...prev.sections] as SectionState["sections"];
      newSections[index] = {
        ...newSections[index],
        source,
        deviceId,
        deviceName,
      };
      return {
        ...prev,
        sections: newSections,
      };
    });
  }, []);

  const setSectionStream = useCallback((index: number, stream: MediaStream | undefined) => {
    setSectionState((prev) => {
      const newSections = [...prev.sections] as SectionState["sections"];
      // Stop previous stream if exists
      if (newSections[index].stream) {
        newSections[index].stream?.getTracks().forEach(track => track.stop());
      }
      newSections[index] = {
        ...newSections[index],
        stream,
      };
      return {
        ...prev,
        sections: newSections,
      };
    });
  }, []);

  const clearSection = useCallback((index: number) => {
    setSectionState((prev) => {
      const newSections = [...prev.sections] as SectionState["sections"];
      // Stop stream if exists
      if (newSections[index].stream) {
        newSections[index].stream?.getTracks().forEach(track => track.stop());
      }
      newSections[index] = { source: null };
      return {
        ...prev,
        sections: newSections,
      };
    });
  }, []);

  const clearAllSections = useCallback(() => {
    setSectionState((prev) => {
      // Stop all streams
      prev.sections.forEach(section => {
        if (section.stream) {
          section.stream.getTracks().forEach(track => track.stop());
        }
      });
      return defaultSectionState;
    });
  }, []);

  // Cleanup streams on unmount
  useEffect(() => {
    return () => {
      sectionState.sections.forEach(section => {
        if (section.stream) {
          section.stream.getTracks().forEach(track => track.stop());
        }
      });
    };
  }, []);

  const value: RecordingContextValue = {
    config,
    updateConfig,
    status,
    devices,
    error,
    startRecording,
    stopRecording,
    fetchDevices,
    // Section-based recording
    sectionState,
    setActiveSectionIndex,
    setSectionSource,
    setSectionStream,
    clearSection,
    clearAllSections,
    browserDevices,
    fetchBrowserDevices,
    // External frame recording
    externalConfig,
    updateExternalConfig,
    isExternalRecording,
    startExternalRecording,
    stopExternalRecording,
  };

  return (
    <RecordingContext.Provider value={value}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecordingContext() {
  const context = useContext(RecordingContext);
  if (!context) {
    throw new Error("useRecordingContext must be used within a RecordingProvider");
  }
  return context;
}
