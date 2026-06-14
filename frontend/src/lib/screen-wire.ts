/**
 * Wire-format codec for native screen frames streamed from Rust.
 *
 * Layout (little-endian):
 *   bytes  0..4  : u32 width  (pixels)
 *   bytes  4..8  : u32 height (pixels)
 *   bytes  8..16 : u64 timestamp_ms
 *   bytes 16..   : JPEG payload
 */

export interface FrameHeader {
  width: number;
  height: number;
  timestampMs: number;
  /** Byte offset where the JPEG payload begins (always 16). */
  jpegOffset: number;
}

/**
 * Parse the 16-byte LE header from a raw native screen frame buffer.
 * Returns null if buf is shorter than 16 bytes.
 */
export function parseFrameHeader(buf: ArrayBuffer): FrameHeader | null {
  if (buf.byteLength < 16) return null;
  const dv = new DataView(buf);
  return {
    width: dv.getUint32(0, true),
    height: dv.getUint32(4, true),
    timestampMs: Number(dv.getBigUint64(8, true)),
    jpegOffset: 16,
  };
}
