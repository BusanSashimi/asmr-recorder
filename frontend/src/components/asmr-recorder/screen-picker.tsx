import { useEffect, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Loader2, Monitor, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScreenPickerController, type PreviewError } from "@/lib/screen-picker";
import type { DisplayInfo } from "@/lib/native-screen";
import type { ScreenRegion } from "@/types/recording";
import { toast } from "@/hooks/use-toast";
import { RegionSelector } from "./region-selector";

interface ScreenPickerProps {
  onClose(): void;
  onConfirm(display: DisplayInfo, region: ScreenRegion): Promise<void>;
}

export function ScreenPicker({ onClose, onConfirm }: ScreenPickerProps) {
  const [controller] = useState(() => new ScreenPickerController());
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const selected = state.entries.find(e => e.display.displayId === state.selectedId);
  useEffect(() => {
    controller.open();
    return controller.close;
  }, [controller]);

  const openSettings = async () => {
    try { await invoke("open_screen_recording_settings"); }
    catch (error) { toast({ title: "Could not open System Settings", description: String(error), variant: "destructive" }); }
  };
  const permission = state.error?.kind === "permissionDenied";
  const issue = (error: PreviewError) => (
    <div className="rounded-lg border border-border bg-fill/40 p-3 text-callout" role="status">
      <p>{error.kind === "permissionDenied"
        ? "Allow ASMR Recorder in System Settings → Privacy & Security → Screen & System Audio Recording. macOS may require Quit & Reopen before access takes effect."
        : error.message}</p>
      {error.kind === "permissionDenied" && (
        <div className="mt-2 flex gap-2">
          <Button onClick={() => void openSettings()}>Open System Settings</Button>
          <Button disabled={state.loading} onClick={() => void controller.refresh()}>Retry</Button>
        </div>
      )}
    </div>
  );

  return <>
    <Dialog open={state.phase === "gallery"} onOpenChange={open => { if (!open && !state.confirming) onClose(); }}>
      <DialogContent className="max-w-[600px] w-[calc(100vw-32px)] overflow-hidden"
        onCloseAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (state.confirming) event.preventDefault(); }}
        onKeyDown={event => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement && selected?.url && !state.confirming && !permission) {
            event.preventDefault(); void controller.continue();
          }
        }}>
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>Select Display</DialogTitle>
          <DialogDescription>Choose a screen, then select the area to capture. Previews are still images.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-1 -m-1 space-y-3">
          {state.error && issue(state.error)}
          {!state.entries.length && <div className="min-h-36 flex flex-col items-center justify-center gap-2 text-muted-foreground text-callout">
            {state.loading ? <><Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />Loading displays…</>
              : <><Monitor className="h-8 w-8" aria-hidden="true" />{state.error ? "Screen previews are unavailable." : "No displays found."}</>}
          </div>}
          <fieldset className="grid grid-cols-2 gap-3" disabled={state.confirming}>
            <legend className="sr-only">Available displays</legend>
            {state.entries.map((entry, index) => {
              const display = entry.display;
              const chosen = display.displayId === state.selectedId;
              const dimensions = `${Math.round(display.width * display.pointPixelScale)} × ${Math.round(display.height * display.pointPixelScale)}`;
              return <label key={display.displayId} className="relative cursor-pointer min-w-0">
                <input type="radio" name="screen-display" value={display.displayId} checked={chosen}
                  onChange={() => controller.select(display.displayId)} className="peer sr-only"
                  aria-label={`Display ${index + 1}${display.isPrimary ? ", primary" : ""}, ${dimensions}${!entry.url && entry.error ? ", preview unavailable" : ""}`} />
                <span className={`block rounded-xl border-2 p-1.5 motion-safe:active:scale-[0.98] transition-[transform,border-color] duration-100 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-elevated ${chosen ? "border-accent bg-accent/5" : "border-border hover:border-muted-foreground"}`}>
                  <span className="relative flex aspect-video items-center justify-center overflow-hidden rounded-md bg-stage text-white/60">
                    {entry.url ? <img src={entry.url} alt="" draggable={false} className="h-full w-full object-contain" />
                      : entry.loading ? <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />
                        : <span className="flex flex-col items-center gap-1 text-caption"><Monitor className="h-6 w-6" aria-hidden="true" />Preview unavailable</span>}
                    {entry.loading && entry.url && <Loader2 className="absolute right-2 bottom-2 h-4 w-4 motion-safe:animate-spin" aria-label="Refreshing preview" />}
                    {chosen && <span className="absolute top-2 right-2 rounded-full bg-accent p-0.5 text-accent-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" /></span>}
                  </span>
                  <span className="mt-2 flex items-center gap-1.5 px-1 text-body font-medium">
                    Display {index + 1}
                    {display.isPrimary && <span className="rounded-sm bg-fill px-1 text-caption font-normal text-muted-foreground">Primary</span>}
                  </span>
                  <span className="block px-1 pb-1 text-caption tabular-nums text-muted-foreground">{dimensions}</span>
                  {entry.error && <span className="block px-1 pb-1 text-caption text-muted-foreground">{entry.url ? "Refresh failed; showing previous preview." : "Refresh to try again."}</span>}
                </span>
              </label>;
            })}
          </fieldset>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-separator pt-3">
          <Button size="lg" aria-disabled={state.loading || state.confirming} className="aria-disabled:opacity-40"
            onClick={() => { if (!state.loading && !state.confirming) void controller.refresh(); }}>
            <RefreshCw className={state.loading ? "motion-safe:animate-spin" : ""} aria-hidden="true" />Refresh
          </Button>
          <div className="flex-1" />
          <Button size="lg" disabled={state.confirming} onClick={onClose}>Cancel</Button>
          <Button size="lg" variant="accent" disabled={!selected?.url || state.confirming || permission} onClick={() => void controller.continue()}>
            {state.confirming && <Loader2 className="motion-safe:animate-spin" aria-hidden="true" />}Continue
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    {state.phase === "crop" && selected && <RegionSelector open onClose={onClose}
      onCloseAutoFocus={event => event.preventDefault()}
      onConfirm={region => { void controller.confirm(display => onConfirm(display, region)).then(success => { if (success) onClose(); }); }}
      screenWidth={selected.display.width} screenHeight={selected.display.height}
      previewUrl={state.cropUrl} previewLoading={state.cropLoading} confirming={state.confirming}
      previewError={state.error?.message} onRefreshPreview={() => void controller.refreshCrop()}
      onOpenSettings={permission ? () => void openSettings() : undefined} />}
  </>;
}
