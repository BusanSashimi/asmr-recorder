interface CapturableCanvas {
  captureStream(frameRate?: number): MediaStream;
}

/** Builds the MediaRecorder fallback stream, preserving the mixed audio track. */
export function captureRecordingStream(
  canvas: CapturableCanvas,
  frameRate: number,
  audioTrack?: MediaStreamTrack | null,
): MediaStream {
  const stream = canvas.captureStream(frameRate);
  if (audioTrack) stream.addTrack(audioTrack);
  return stream;
}
