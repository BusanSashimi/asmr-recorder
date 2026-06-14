import { describe, it, expect } from "vitest";
import { gainToDb } from "./gain-to-db";

describe("gainToDb", () => {
  it("returns 0.0 dB for unity gain", () => {
    expect(gainToDb(1)).toBe("0.0 dB");
  });
  it("returns −∞ for zero gain", () => {
    expect(gainToDb(0)).toBe("−∞");
  });
  it("returns −∞ for negative gain", () => {
    expect(gainToDb(-0.5)).toBe("−∞");
  });
  it("returns approx +6.0 dB for gain=2", () => {
    expect(gainToDb(2)).toBe("6.0 dB");
  });
  it("returns approx +9.5 dB for gain=3", () => {
    const v = gainToDb(3);
    expect(v).toMatch(/^9\.\d dB$/);
  });
});
