import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  StreamTarget,
  StreamTargetChunk,
} from "mediabunny";
import type { RecordingArtifact } from "@/types/editable-media";

export type RecordingContainer = "mp4" | "webm";
export type RecordingPurpose = "capture" | "trim";

interface RecordingFileSessionResponse {
  sessionId: string;
}

export const RECORDING_TARGET_CHUNK_BYTES = 8 * 1024 * 1024;
export const MEDIA_RECORDER_PENDING_BYTES_LIMIT = 32 * 1024 * 1024;

/**
 * A bounded, seekable file session owned by the Rust backend. The session must
 * be finalized or aborted exactly once.
 */
export class RecordingFileSession {
  readonly sessionId: string;
  private settled = false;

  private constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  static async begin(
    container: RecordingContainer,
    purpose: RecordingPurpose,
  ): Promise<RecordingFileSession> {
    if (!isTauri()) {
      throw new Error("File-backed recordings require the desktop app");
    }
    const response = await invoke<RecordingFileSessionResponse>(
      "begin_recording_file",
      { container, purpose },
    );
    return new RecordingFileSession(response.sessionId);
  }

  async write(position: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
    if (this.settled) throw new Error("Recording file session is closed");
    if (!Number.isSafeInteger(position) || position < 0) {
      throw new Error("Invalid recording file position");
    }
    if (data.byteLength === 0) return;
    await invoke("write_recording_file", data, {
      headers: {
        "x-recording-session-id": this.sessionId,
        "x-recording-position": String(position),
      },
    });
  }

  async finalize(): Promise<RecordingArtifact> {
    if (this.settled) throw new Error("Recording file session is closed");
    this.settled = true;
    try {
      return await invoke<RecordingArtifact>("finalize_recording_file", {
        sessionId: this.sessionId,
      });
    } catch (error) {
      // If finalization failed before Rust consumed the request, make a
      // best-effort cleanup attempt. Backend abort is idempotent if it did run.
      await invoke("abort_recording_file", {
        sessionId: this.sessionId,
      }).catch(() => {});
      throw error;
    }
  }

  async abort(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    await invoke("abort_recording_file", { sessionId: this.sessionId });
  }
}

export interface FileBackedTarget {
  target: StreamTarget;
  session: RecordingFileSession;
}

export async function createFileBackedTarget(
  mediabunny: typeof import("mediabunny"),
  container: RecordingContainer,
  purpose: RecordingPurpose,
): Promise<FileBackedTarget> {
  const session = await RecordingFileSession.begin(container, purpose);
  const writable = new WritableStream<StreamTargetChunk>({
    write: (chunk) => session.write(chunk.position, chunk.data),
    abort: () => session.abort(),
  });
  return {
    target: new mediabunny.StreamTarget(writable, {
      chunked: true,
      chunkSize: RECORDING_TARGET_CHUNK_BYTES,
    }),
    session,
  };
}
