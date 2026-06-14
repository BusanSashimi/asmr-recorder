import { describe, it, expect } from "vitest";
import { parseFrameHeader } from "./screen-wire";

function makeHeader(width: number, height: number, timestampMs: bigint): ArrayBuffer {
  const buf = new ArrayBuffer(32); // header + dummy JPEG bytes
  const dv = new DataView(buf);
  dv.setUint32(0, width, true);
  dv.setUint32(4, height, true);
  dv.setBigUint64(8, timestampMs, true);
  return buf;
}

describe("parseFrameHeader", () => {
  it("parses width, height, timestampMs from a valid buffer", () => {
    const buf = makeHeader(1280, 720, 987654321n);
    const h = parseFrameHeader(buf);
    expect(h).not.toBeNull();
    expect(h!.width).toBe(1280);
    expect(h!.height).toBe(720);
    expect(h!.timestampMs).toBe(987654321);
    expect(h!.jpegOffset).toBe(16);
  });

  it("returns null for a buffer shorter than 16 bytes", () => {
    expect(parseFrameHeader(new ArrayBuffer(15))).toBeNull();
    expect(parseFrameHeader(new ArrayBuffer(0))).toBeNull();
  });

  it("accepts a buffer exactly 16 bytes (header-only, no payload)", () => {
    const buf = makeHeader(100, 200, 0n);
    const trimmed = buf.slice(0, 16);
    const h = parseFrameHeader(trimmed);
    expect(h).not.toBeNull();
    expect(h!.width).toBe(100);
  });

  it("is little-endian: width 0x00000100 = 256", () => {
    const buf = new ArrayBuffer(16);
    const dv = new DataView(buf);
    // Write 256 in little-endian: bytes [0x00, 0x01, 0x00, 0x00]
    dv.setUint32(0, 256, true);
    dv.setUint32(4, 1, true);
    dv.setBigUint64(8, 0n, true);
    expect(parseFrameHeader(buf)!.width).toBe(256);
  });

  it("handles a large timestamp near u64 max without overflow", () => {
    // Number.MAX_SAFE_INTEGER = 2^53 - 1; timestamps in ms fit well within this
    const ts = BigInt(Number.MAX_SAFE_INTEGER);
    const buf = makeHeader(1, 1, ts);
    expect(parseFrameHeader(buf)!.timestampMs).toBe(Number.MAX_SAFE_INTEGER);
  });
});
