import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type { Update };

export async function checkForUpdate(): Promise<Update | null> {
  try {
    return await check();
  } catch {
    // Treat unreachable endpoint as "up to date for now"
    return null;
  }
}

export async function applyUpdate(
  update: Update,
  onProgress?: (fraction: number) => void
): Promise<void> {
  let total = 0;
  let got = 0;
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") {
      total = e.data.contentLength ?? 0;
    } else if (e.event === "Progress") {
      got += e.data.chunkLength;
      if (total > 0) onProgress?.(got / total);
    }
  });
  await relaunch();
}
