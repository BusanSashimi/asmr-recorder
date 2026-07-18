export const MAX_SOUNDBITE_BYTES = 25 * 1024 * 1024;
export const MAX_SOUNDBITE_SECONDS = 30;

interface SoundbiteFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export async function validateSoundbite(
  file: SoundbiteFile,
  decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>,
): Promise<{ bytes: ArrayBuffer; buffer: AudioBuffer }> {
  if (!file.type.toLowerCase().startsWith("audio/")) {
    throw new Error(`${file.name}: choose an audio file`);
  }
  if (file.size <= 0 || file.size > MAX_SOUNDBITE_BYTES) {
    throw new Error(`${file.name}: soundbites must be 25 MB or smaller`);
  }
  const bytes = await file.arrayBuffer();
  let buffer: AudioBuffer;
  try {
    buffer = await decode(bytes.slice(0));
  } catch {
    throw new Error(`${file.name}: unsupported or corrupt audio`);
  }
  if (!Number.isFinite(buffer.duration) || buffer.duration <= 0) {
    throw new Error(`${file.name}: audio has no playable samples`);
  }
  if (buffer.duration > MAX_SOUNDBITE_SECONDS) {
    throw new Error(`${file.name}: soundbites must be 30 seconds or shorter`);
  }
  return { bytes, buffer };
}
