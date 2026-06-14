import { describe, it, expect } from "vitest";
import { parseAudioChunkHeader, AUDIO_HEADER_BYTES } from "./audio-wire";

function makeAudioHeader(
  sampleRate: number,
  channels: number,
  timestampMs: bigint,
  payloadBytes = 0,
): ArrayBuffer {
  const buf = new ArrayBuffer(AUDIO_HEADER_BYTES + payloadBytes);
  const dv = new DataView(buf);
  dv.setUint32(0, sampleRate, true);
  dv.setUint16(4, channels, true);
  dv.setUint16(6, 0, true); // reserved
  dv.setBigUint64(8, timestampMs, true);
  return buf;
}

describe("parseAudioChunkHeader", () => {
  it("parses sampleRate, channels, timestampMs from a valid buffer", () => {
    const buf = makeAudioHeader(48000, 2, 123456789n, 64);
    const h = parseAudioChunkHeader(buf);
    expect(h).not.toBeNull();
    expect(h!.sampleRate).toBe(48000);
    expect(h!.channels).toBe(2);
    expect(h!.timestampMs).toBe(123456789);
    expect(h!.pcmOffset).toBe(16);
  });

  it("returns null for buffers shorter than 16 bytes", () => {
    expect(parseAudioChunkHeader(new ArrayBuffer(15))).toBeNull();
    expect(parseAudioChunkHeader(new ArrayBuffer(0))).toBeNull();
  });

  it("accepts a buffer exactly 16 bytes (header only)", () => {
    const buf = makeAudioHeader(44100, 1, 0n);
    expect(parseAudioChunkHeader(buf)!.sampleRate).toBe(44100);
    expect(parseAudioChunkHeader(buf)!.channels).toBe(1);
  });

  it("AUDIO_HEADER_BYTES is 16", () => {
    expect(AUDIO_HEADER_BYTES).toBe(16);
  });

  it("pcmOffset equals AUDIO_HEADER_BYTES", () => {
    const buf = makeAudioHeader(48000, 2, 0n);
    expect(parseAudioChunkHeader(buf)!.pcmOffset).toBe(AUDIO_HEADER_BYTES);
  });
});
