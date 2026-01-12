import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { defaultRecordingConfig } from "@/types/recording";
import type { RecordingConfig, RecordingStatus, DeviceList } from "@/types/recording";

export function useRecording() {
  const [config, setConfig] = useState<RecordingConfig>(defaultRecordingConfig);
  const [status, setStatus] = useState<RecordingStatus>({
    isRecording: false,
    durationMs: 0,
    frameCount: 0,
  });
  const [devices, setDevices] = useState<DeviceList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusPollRef = useRef<number | null>(null);

  // Fetch available devices
  const fetchDevices = useCallback(async () => {
    try {
      const deviceList = await invoke<DeviceList>("get_available_devices");
      setDevices(deviceList);
    } catch (err) {
      console.error("Failed to fetch devices:", err);
      setError(String(err));
    }
  }, []);

  // Fetch devices on mount
  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // Poll recording status when recording
  useEffect(() => {
    if (status.isRecording) {
      statusPollRef.current = window.setInterval(async () => {
        try {
          const newStatus = await invoke<RecordingStatus>(
            "get_recording_status_live"
          );
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
  }, [status.isRecording]);

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
  const updateConfig = useCallback(
    (updates: Partial<RecordingConfig>) => {
      setConfig((prev) => ({ ...prev, ...updates }));
    },
    []
  );

  return {
    config,
    updateConfig,
    status,
    devices,
    error,
    startRecording,
    stopRecording,
    fetchDevices,
  };
}
