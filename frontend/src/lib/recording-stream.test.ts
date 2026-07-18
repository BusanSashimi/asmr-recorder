import { describe, expect, it } from "vitest";
import { captureRecordingStream } from "./recording-stream";

describe("captureRecordingStream", () => {
  it("adds the mixed audio track to the MediaRecorder fallback", () => {
    const added: MediaStreamTrack[] = [];
    const stream = {
      addTrack: (track: MediaStreamTrack) => {
        added.push(track);
      },
    } as unknown as MediaStream;
    const canvas = { captureStream: () => stream };
    const audioTrack = { kind: "audio" } as MediaStreamTrack;
    expect(captureRecordingStream(canvas, 30, audioTrack)).toBe(stream);
    expect(added).toEqual([audioTrack]);
  });

  it("keeps the fallback video-only when no mixed track exists", () => {
    const added: MediaStreamTrack[] = [];
    const stream = {
      addTrack: (track: MediaStreamTrack) => {
        added.push(track);
      },
    } as unknown as MediaStream;
    captureRecordingStream({ captureStream: () => stream }, 30, null);
    expect(added).toHaveLength(0);
  });
});
