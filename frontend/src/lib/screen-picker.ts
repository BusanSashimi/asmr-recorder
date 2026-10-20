import { invoke } from "@tauri-apps/api/core";
import { listDisplays, type DisplayInfo } from "./native-screen";

export interface PreviewError { kind: string; message: string }
export function previewError(error: unknown): PreviewError {
  if (error && typeof error === "object" && "kind" in error && "message" in error) {
    return { kind: String(error.kind), message: String(error.message) };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { kind: /permission|declined|tcc/i.test(message) ? "permissionDenied" : "captureFailed", message };
}

export function sameDisplayGeometry(a: DisplayInfo, b: DisplayInfo): boolean {
  return a.displayId === b.displayId && a.width === b.width && a.height === b.height
    && Math.abs(a.pointPixelScale - b.pointPixelScale) < 0.001;
}

export interface PreviewEntry {
  display: DisplayInfo;
  url?: string;
  loading: boolean;
  error?: PreviewError;
}

export interface PickerState {
  phase: "gallery" | "crop";
  entries: PreviewEntry[];
  selectedId: number | null;
  loading: boolean;
  error?: PreviewError;
  cropUrl?: string;
  cropLoading: boolean;
  confirming: boolean;
}

interface PickerApi {
  list(): Promise<DisplayInfo[]>;
  capture(display: DisplayInfo, dimension: number, current: () => boolean): Promise<string>;
  release(url: string): void;
  visible(): boolean;
}

// Serialize across chooser instances too: cancelled/closed native calls may finish later.
let captureQueue: Promise<unknown> = Promise.resolve();
const nativeApi: PickerApi = {
  list: listDisplays,
  capture(display, maxDimension, current) {
    const request = captureQueue.then(async () => {
      if (!current() || document.hidden) throw { kind: "cancelled", message: "Preview cancelled." };
      const bytes = await invoke<ArrayBuffer>("capture_display_preview", {
        displayId: display.displayId,
        expectedGeometry: { width: display.width, height: display.height, pointPixelScale: display.pointPixelScale },
        maxDimension,
      });
      const blob = new Blob([bytes], { type: "image/jpeg" });
      // Validate before creating a URL or enabling Continue.
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
      return URL.createObjectURL(blob);
    });
    captureQueue = request.catch(() => {});
    return request;
  },
  release: url => URL.revokeObjectURL(url),
  visible: () => !document.hidden,
};

const initial = (): PickerState => ({ phase: "gallery", entries: [], selectedId: null,
  loading: false, cropLoading: false, confirming: false });

/** Owns only ephemeral chooser resources; never owns a recording stream. */
export class ScreenPickerController {
  private state = initial();
  private generation = 0;
  private opened = false;
  private listeners = new Set<() => void>();
  private api: PickerApi;
  constructor(api: PickerApi = nativeApi) { this.api = api; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<PickerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  private releaseUnused(previous: PickerState) {
    const retained = new Set([...this.state.entries.map(e => e.url), this.state.cropUrl]);
    const old = new Set([...previous.entries.map(e => e.url), previous.cropUrl]);
    old.forEach(url => { if (url && !retained.has(url)) this.api.release(url); });
  }
  open = () => {
    this.opened = true;
    this.state = initial();
    void this.refresh(true);
  };
  close = () => {
    this.opened = false;
    this.generation++;
    const previous = this.state;
    this.state = initial();
    this.releaseUnused(previous);
  };
  select = (selectedId: number) => { this.update({ selectedId }); };

  refresh = async (first = false, explanation?: PreviewError, clearSelection = false) => {
    if (!this.opened || !this.api.visible()) return;
    const generation = ++this.generation;
    const current = () => this.opened && generation === this.generation;
    this.update({ phase: "gallery", loading: true, cropLoading: false, confirming: false, error: explanation });
    try {
      const displays = (await this.api.list()).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.displayId - b.displayId);
      if (!current()) return;
      const previous = this.state;
      const entries = displays.map(display => {
        const old = previous.entries.find(entry => sameDisplayGeometry(entry.display, display));
        return { display, url: old?.url, loading: true } as PreviewEntry;
      });
      const selectedId = clearSelection ? null : first || previous.entries.length === 0 ? displays[0]?.displayId ?? null
        : displays.some(d => d.displayId === previous.selectedId) ? previous.selectedId : null;
      this.update({ entries, selectedId, cropUrl: undefined });
      this.releaseUnused(previous);
      for (const entry of entries) {
        if (!current() || !this.api.visible()) break;
        try {
          const url = await this.api.capture(entry.display, 480, current);
          if (!current()) { this.api.release(url); return; }
          const before = this.state;
          this.update({ entries: this.state.entries.map(e => e.display.displayId === entry.display.displayId
            ? { display: entry.display, url, loading: false } : e) });
          this.releaseUnused(before);
        } catch (error) {
          if (!current()) return;
          const failure = previewError(error);
          this.update({ entries: this.state.entries.map(e => e.display.displayId === entry.display.displayId
            ? { ...e, loading: false, error: failure } : e) });
          if (failure.kind === "permissionDenied") {
            this.update({ error: failure });
            break;
          }
        }
      }
    } catch (error) {
      if (current()) this.update({ error: previewError(error) });
    } finally {
      if (current()) this.update({ loading: false, entries: this.state.entries.map(e => ({ ...e, loading: false })) });
    }
  };

  private selected() {
    return this.state.entries.find(e => e.display.displayId === this.state.selectedId);
  }
  continue = async () => {
    const selected = this.selected();
    if (!selected?.url || this.state.confirming) return;
    const generation = ++this.generation; // Retire unfinished gallery thumbnails.
    this.update({ loading: true, confirming: true });
    try {
      const displays = await this.api.list();
      if (!this.opened || generation !== this.generation) return;
      const fresh = displays.find(d => sameDisplayGeometry(d, selected.display));
      if (!fresh) {
        await this.refresh(false, { kind: "geometryChanged", message: "The selected screen changed or disconnected. Choose a screen again." }, true);
        return;
      }
      this.update({ phase: "crop", cropUrl: selected.url, loading: false, confirming: false, error: undefined });
      void this.refreshCrop();
    } catch (error) {
      if (this.opened && generation === this.generation) this.update({ error: previewError(error), loading: false, confirming: false });
    }
  };
  refreshCrop = async () => {
    const selected = this.selected();
    if (!selected || !this.opened || !this.api.visible()) return;
    const generation = ++this.generation;
    const current = () => this.opened && generation === this.generation;
    this.update({ cropLoading: true, error: undefined });
    try {
      const url = await this.api.capture(selected.display, 1600, current);
      if (!current()) { this.api.release(url); return; }
      const previous = this.state;
      this.update({ cropUrl: url });
      this.releaseUnused(previous);
    } catch (error) {
      if (!current()) return;
      const failure = previewError(error);
      if (failure.kind === "geometryChanged" || failure.kind === "displayUnavailable") {
        await this.refresh(false, failure, true);
      } else if (failure.kind !== "cancelled") this.update({ error: failure });
    } finally {
      if (current()) this.update({ cropLoading: false });
    }
  };
  confirm = async (action: (display: DisplayInfo) => Promise<void>): Promise<boolean> => {
    const selected = this.selected();
    if (!selected || this.state.confirming) return false;
    const generation = ++this.generation;
    this.update({ confirming: true, cropLoading: false, error: undefined });
    try {
      await action(selected.display);
      return this.opened && generation === this.generation;
    } catch (error) {
      if (!this.opened || generation !== this.generation) return false;
      const failure = previewError(error);
      if (failure.kind === "geometryChanged" || failure.kind === "displayUnavailable") {
        await this.refresh(false, failure, true);
      } else this.update({ error: failure, confirming: false });
      return false;
    }
  };
}
