import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export function Recorder() {
  const [status, setStatus] = useState<string>('Ready to record');

  async function startAudio() {
    try {
      setStatus('Starting audio capture...');
      await invoke('start_audio_capture');
      setStatus('Audio capture started');
    } catch (error) {
      console.error(error);
      setStatus(`Error: ${error}`);
    }
  }

  async function startScreen() {
    try {
      setStatus('Starting screen capture...');
      await invoke('start_screen_capture');
      setStatus('Screen capture started');
    } catch (error) {
      console.error(error);
      setStatus(`Error: ${error}`);
    }
  }

  return (
    <div className="recorder-container">
      <h2>Recorder</h2>
      <p>Status: {status}</p>
      <div className="buttons">
        <button onClick={startAudio}>Start Audio Capture</button>
        <button onClick={startScreen}>Start Screen Capture</button>
      </div>
    </div>
  );
}
