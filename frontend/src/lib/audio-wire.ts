/**
 * Wire-format codec for native system-audio chunks streamed from Rust.
 *
 * Layout (little-endian):
 *   bytes  0..4  : u32 sample_rate
 *   bytes  4..6  : u16 channels
 *   bytes  6..8  : u16 reserved (zero)
 *   bytes  8..16 : u64 timestamp_ms
 *   bytes 16..   : interleaved f32 PCM (4-byte aligned for zero-copy Float32Array view)
 */

export const AUDIO_HEADER_BYTES = 16;

export interface AudioChunkHeader {
  sampleRate: number;
  channels: number;
  timestampMs: number;
  /** Byte offset where the PCM payload begins (always 16). */
  pcmOffset: number;
}

/**
 * Parse the 16-byte LE header from a raw native audio chunk buffer.
 * Returns null if buf is shorter than 16 bytes.
 */
export function parseAudioChunkHeader(buf: ArrayBuffer): AudioChunkHeader | null {
  if (buf.byteLength < AUDIO_HEADER_BYTES) return null;
  const dv = new DataView(buf);
  return {
    sampleRate: dv.getUint32(0, true),
    channels: dv.getUint16(4, true),
    timestampMs: Number(dv.getBigUint64(8, true)),
    pcmOffset: AUDIO_HEADER_BYTES,
  };
}
