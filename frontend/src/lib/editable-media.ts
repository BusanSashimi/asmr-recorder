import { convertFileSrc } from "@tauri-apps/api/core";
import type { EditableMedia } from "@/types/editable-media";

export interface EditableMediaUrl {
  url: string;
  revoke: () => void;
}

export function createEditableMediaUrl(media: EditableMedia): EditableMediaUrl {
  if (media.kind === "file") {
    return {
      url: convertFileSrc(media.artifact.path),
      revoke: () => {},
    };
  }
  const url = URL.createObjectURL(media.blob);
  return {
    url,
    revoke: () => URL.revokeObjectURL(url),
  };
}

export function editableMediaName(media: EditableMedia): string {
  if (media.kind === "file") return media.artifact.fileName;
  return media.blob instanceof File ? media.blob.name : "Recording";
}
