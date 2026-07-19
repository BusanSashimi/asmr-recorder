import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => true,
}));

import { RecordingFileSession } from "./recording-file";

describe("RecordingFileSession", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("starts a typed session and writes at an explicit offset", async () => {
    invokeMock.mockResolvedValueOnce({ sessionId: "session-1" });
    const session = await RecordingFileSession.begin("mp4", "capture");
    const bytes = new Uint8Array([1, 2, 3]);
    invokeMock.mockResolvedValueOnce(undefined);

    await session.write(4096, bytes);

    expect(invokeMock).toHaveBeenNthCalledWith(1, "begin_recording_file", {
      container: "mp4",
      purpose: "capture",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "write_recording_file",
      bytes,
      {
        headers: {
          "x-recording-session-id": "session-1",
          "x-recording-position": "4096",
        },
      },
    );
  });

  it("finalizes exactly once", async () => {
    const artifact = {
      path: "/tmp/recording.mp4",
      fileName: "recording.mp4",
      mimeType: "video/mp4" as const,
      byteSize: 12,
    };
    invokeMock
      .mockResolvedValueOnce({ sessionId: "session-2" })
      .mockResolvedValueOnce(artifact);
    const session = await RecordingFileSession.begin("mp4", "trim");

    await expect(session.finalize()).resolves.toEqual(artifact);
    await expect(session.finalize()).rejects.toThrow(
      "Recording file session is closed",
    );
    await session.abort();

    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("aborts once and rejects later writes", async () => {
    invokeMock
      .mockResolvedValueOnce({ sessionId: "session-3" })
      .mockResolvedValueOnce(undefined);
    const session = await RecordingFileSession.begin("webm", "capture");

    await session.abort();
    await session.abort();
    await expect(session.write(0, new Uint8Array([1]))).rejects.toThrow(
      "Recording file session is closed",
    );

    expect(invokeMock).toHaveBeenLastCalledWith("abort_recording_file", {
      sessionId: "session-3",
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("attempts cleanup when finalization fails", async () => {
    invokeMock
      .mockResolvedValueOnce({ sessionId: "session-4" })
      .mockRejectedValueOnce(new Error("finalize failed"))
      .mockResolvedValueOnce(undefined);
    const session = await RecordingFileSession.begin("mp4", "capture");

    await expect(session.finalize()).rejects.toThrow("finalize failed");

    expect(invokeMock).toHaveBeenLastCalledWith("abort_recording_file", {
      sessionId: "session-4",
    });
  });
});
