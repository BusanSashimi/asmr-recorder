export interface RecordingArtifact {
  path: string;
  fileName: string;
  mimeType: "video/mp4" | "video/webm";
  byteSize: number;
}

export type EditableMedia =
  | { kind: "file"; artifact: RecordingArtifact }
  | { kind: "blob"; blob: Blob };

export interface RecordingReadyForEditDetail {
  media: EditableMedia;
}

export function dispatchRecordingReadyForEdit(media: EditableMedia): void {
  window.dispatchEvent(
    new CustomEvent<RecordingReadyForEditDetail>("recordingReadyForEdit", {
      detail: { media },
    }),
  );
}
