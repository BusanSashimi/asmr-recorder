import { describe, expect, it } from "vitest";
import { MAX_SOUNDBITE_BYTES, validateSoundbite } from "./soundbite-validation";

const file = (updates: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: "tap.wav",
  type: "audio/wav",
  size: 12,
  arrayBuffer: async () => new ArrayBuffer(12),
  ...updates,
});
const decoded = (duration: number) => ({ duration }) as AudioBuffer;

describe("validateSoundbite", () => {
  it("accepts successfully decoded audio", async () => {
    const result = await validateSoundbite(file(), async () => decoded(2.5));
    expect(result.buffer.duration).toBe(2.5);
  });

  it("rejects size, duration, MIME, and decode failures", async () => {
    await expect(validateSoundbite(file({ size: MAX_SOUNDBITE_BYTES + 1 }), async () => decoded(1))).rejects.toThrow("25 MB");
    await expect(validateSoundbite(file({ type: "text/plain" }), async () => decoded(1))).rejects.toThrow("audio file");
    await expect(validateSoundbite(file(), async () => decoded(30.01))).rejects.toThrow("30 seconds");
    await expect(validateSoundbite(file(), async () => { throw new Error("bad"); })).rejects.toThrow("corrupt");
  });
});
