import { useState, useRef, useCallback, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogPortal, DialogOverlay, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { animate, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Check, X, Maximize2, RefreshCw, Loader2 } from "lucide-react";
import { spring, rubberband } from "@/lib/motion";

interface RegionSelectorProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (region: { x: number; y: number; width: number; height: number }) => void;
  screenWidth?: number;
  screenHeight?: number;
  stream?: MediaStream | null;
  previewUrl?: string;
  previewLoading?: boolean;
  previewError?: string;
  confirming?: boolean;
  onRefreshPreview?: () => void;
  onOpenSettings?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 100;

export function RegionSelector(props: RegionSelectorProps) {
  // A fresh mount resets crop/gesture state for every opening, including browser capture.
  return props.open ? <RegionSelectorContent {...props} /> : null;
}

function RegionSelectorContent({
  onClose,
  onConfirm,
  screenWidth = 1920,
  screenHeight = 1080,
  stream, previewUrl, previewLoading = false, previewError, confirming = false,
  onRefreshPreview, onOpenSettings, onCloseAutoFocus,
}: RegionSelectorProps) {
  const [region, setRegion] = useState<Region>({
    x: screenWidth * 0.25,
    y: screenHeight * 0.25,
    width: screenWidth * 0.5,
    height: screenHeight * 0.5,
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [regionStart, setRegionStart] = useState<Region>(region);
  const [visualOffset, setVisualOffset] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const visualOffsetRef = useRef({ x: 0, y: 0 });
  const animXRef = useRef<{ stop: () => void } | null>(null);
  const animYRef = useRef<{ stop: () => void } | null>(null);
  const offsetSamplesRef = useRef<Array<{ x: number; y: number; t: number }>>([]);
  const prefersReducedMotion = useReducedMotion();

  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); animXRef.current?.stop(); animYRef.current?.stop(); };
  }, []);
  const scale = Math.min(
    Math.max(1, viewport.width - 64) / screenWidth,
    Math.max(1, viewport.height - (previewError ? 280 : 220)) / screenHeight,
    1
  );

  const scaledWidth = screenWidth * scale;
  const scaledHeight = screenHeight * scale;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, action: "drag" | string) => {
      if (confirming) return;
      e.preventDefault();
      e.stopPropagation();

      animXRef.current?.stop();
      animYRef.current?.stop();
      visualOffsetRef.current = { x: 0, y: 0 };
      setVisualOffset({ x: 0, y: 0 });
      offsetSamplesRef.current = [];

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const ptrX = (e.clientX - rect.left) / scale;
      const ptrY = (e.clientY - rect.top) / scale;

      setDragStart({ x: ptrX, y: ptrY });
      setRegionStart({ ...region });

      if (action === "drag") {
        setIsDragging(true);
      } else {
        setIsResizing(action);
      }

      // Capture pointer on the container so pointermove/pointerup arrive there
      containerRef.current?.setPointerCapture(e.pointerId);
    },
    [region, scale, confirming]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging && !isResizing) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const ptrX = (e.clientX - rect.left) / scale;
      const ptrY = (e.clientY - rect.top) / scale;

      const deltaX = ptrX - dragStart.x;
      const deltaY = ptrY - dragStart.y;

      if (isDragging) {
        const rawX = regionStart.x + deltaX;
        const rawY = regionStart.y + deltaY;

        const clampedX = Math.max(0, Math.min(screenWidth - regionStart.width, rawX));
        const clampedY = Math.max(0, Math.min(screenHeight - regionStart.height, rawY));

        setRegion({ ...regionStart, x: clampedX, y: clampedY });

        // Rubber-band: overshoot in CSS pixels
        const overshootX = (rawX - clampedX) * scale;
        const overshootY = (rawY - clampedY) * scale;
        const vx = overshootX !== 0 ? rubberband(overshootX, scaledWidth) : 0;
        const vy = overshootY !== 0 ? rubberband(overshootY, scaledHeight) : 0;

        visualOffsetRef.current = { x: vx, y: vy };
        setVisualOffset({ x: vx, y: vy });

        const sample = { x: vx, y: vy, t: e.timeStamp };
        offsetSamplesRef.current.push(sample);
        if (offsetSamplesRef.current.length > 5) offsetSamplesRef.current.shift();
      } else if (isResizing) {
        const newRegion = { ...regionStart };

        switch (isResizing) {
          case "nw":
            newRegion.width = Math.max(MIN_SIZE, regionStart.width - deltaX);
            newRegion.height = Math.max(MIN_SIZE, regionStart.height - deltaY);
            newRegion.x = regionStart.x + regionStart.width - newRegion.width;
            newRegion.y = regionStart.y + regionStart.height - newRegion.height;
            break;
          case "ne":
            newRegion.width = Math.max(MIN_SIZE, regionStart.width + deltaX);
            newRegion.height = Math.max(MIN_SIZE, regionStart.height - deltaY);
            newRegion.y = regionStart.y + regionStart.height - newRegion.height;
            break;
          case "sw":
            newRegion.width = Math.max(MIN_SIZE, regionStart.width - deltaX);
            newRegion.height = Math.max(MIN_SIZE, regionStart.height + deltaY);
            newRegion.x = regionStart.x + regionStart.width - newRegion.width;
            break;
          case "se":
            newRegion.width = Math.max(MIN_SIZE, regionStart.width + deltaX);
            newRegion.height = Math.max(MIN_SIZE, regionStart.height + deltaY);
            break;
          case "n":
            newRegion.height = Math.max(MIN_SIZE, regionStart.height - deltaY);
            newRegion.y = regionStart.y + regionStart.height - newRegion.height;
            break;
          case "s":
            newRegion.height = Math.max(MIN_SIZE, regionStart.height + deltaY);
            break;
          case "e":
            newRegion.width = Math.max(MIN_SIZE, regionStart.width + deltaX);
            break;
          case "w":
            newRegion.width = Math.max(MIN_SIZE, regionStart.width - deltaX);
            newRegion.x = regionStart.x + regionStart.width - newRegion.width;
            break;
        }

        newRegion.x = Math.max(0, newRegion.x);
        newRegion.y = Math.max(0, newRegion.y);
        newRegion.width = Math.min(screenWidth - newRegion.x, newRegion.width);
        newRegion.height = Math.min(screenHeight - newRegion.y, newRegion.height);

        setRegion(newRegion);
      }
    },
    [
      isDragging,
      isResizing,
      dragStart,
      regionStart,
      scale,
      screenWidth,
      screenHeight,
      scaledWidth,
      scaledHeight,
    ]
  );

  const handlePointerUp = useCallback(() => {
    const wasDragging = isDragging;
    setIsDragging(false);
    setIsResizing(null);

    if (!wasDragging) {
      visualOffsetRef.current = { x: 0, y: 0 };
      setVisualOffset({ x: 0, y: 0 });
      return;
    }

    // Compute release velocity from tracked visual-offset samples
    const samples = offsetSamplesRef.current;
    let velX = 0;
    let velY = 0;
    if (samples.length >= 2) {
      const last = samples[samples.length - 1];
      const prev = samples[samples.length - 2];
      const dt = (last.t - prev.t) / 1000;
      if (dt > 0) {
        velX = (last.x - prev.x) / dt;
        velY = (last.y - prev.y) / dt;
      }
    }

    const { x: startX, y: startY } = visualOffsetRef.current;

    if (Math.abs(startX) > 0.5 && !prefersReducedMotion) {
      animXRef.current = animate(startX, 0, {
        ...spring.momentum,
        velocity: velX,
        onUpdate: (v: number) => {
          visualOffsetRef.current.x = v;
          setVisualOffset((prev) => ({ ...prev, x: v }));
        },
      }) as unknown as { stop: () => void };
    } else {
      visualOffsetRef.current.x = 0;
      setVisualOffset((prev) => ({ ...prev, x: 0 }));
    }

    if (Math.abs(startY) > 0.5 && !prefersReducedMotion) {
      animYRef.current = animate(startY, 0, {
        ...spring.momentum,
        velocity: velY,
        onUpdate: (v: number) => {
          visualOffsetRef.current.y = v;
          setVisualOffset((prev) => ({ ...prev, y: v }));
        },
      }) as unknown as { stop: () => void };
    } else {
      visualOffsetRef.current.y = 0;
      setVisualOffset((prev) => ({ ...prev, y: 0 }));
    }
  }, [isDragging, prefersReducedMotion]);

  const handlePointerCancel = useCallback(() => {
    setIsDragging(false);
    setIsResizing(null);
    visualOffsetRef.current = { x: 0, y: 0 };
    setVisualOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const handleConfirm = () => {
    onConfirm({
      x: Math.round(region.x),
      y: Math.round(region.y),
      width: Math.round(region.width),
      height: Math.round(region.height),
    });
  };

  const scaledRegion = {
    x: region.x * scale + visualOffset.x,
    y: region.y * scale + visualOffset.y,
    width: region.width * scale,
    height: region.height * scale,
  };

  // Handle style for the region body (pointer-down action="drag")
  const handleShadow =
    "shadow-[0_0_0_1px_hsl(var(--record)),0_1px_3px_rgba(0,0,0,.4)]";

  // Portaled: the preview stage is a size container, which would otherwise
  // become the containing block for this fixed overlay.
  return (
    <Dialog open onOpenChange={value => { if (!value && !confirming) onClose(); }}>
    <DialogPortal>
    <DialogOverlay className="bg-black/70" />
    <DialogPrimitive.Content className="fixed inset-0 z-50 flex items-center justify-center outline-none text-white"
      onCloseAutoFocus={onCloseAutoFocus}
      onEscapeKeyDown={event => { if (confirming) event.preventDefault(); }}
      onPointerDownOutside={event => event.preventDefault()}>

      <div className="flex flex-col items-center gap-4">
        {/* Header */}
        <div className="text-center">
          <DialogTitle className="text-title text-white">Select Capture Region</DialogTitle>
          <DialogDescription className="text-caption text-white/60 mt-0.5">
            Drag to move or resize. Arrow keys move; Option + arrows resize.
          </DialogDescription>
        </div>

        {/* Screen preview container */}
        <div
          ref={containerRef}
          className="relative bg-stage rounded-lg overflow-hidden shadow-sheet ring-1 ring-white/10"
          style={{ width: scaledWidth, height: scaledHeight }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          {previewUrl && <img src={previewUrl} alt="Selected display" draggable={false}
            className="absolute inset-0 w-full h-full object-contain bg-black pointer-events-none" />}
          {/* Video feed background */}
          {stream && (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-contain bg-black"
            />
          )}

          {/* Fallback grid pattern when no stream */}
          {!stream && !previewUrl && (
            <div className="absolute inset-0">
              <div className="absolute inset-0 opacity-10">
                <div
                  className="w-full h-full"
                  style={{
                    backgroundImage: `
                      linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
                    `,
                    backgroundSize: `${50 * scale}px ${50 * scale}px`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Outside-selection mask */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Top */}
            <div
              className="absolute bg-black/55"
              style={{ top: 0, left: 0, right: 0, height: scaledRegion.y }}
            />
            {/* Bottom */}
            <div
              className="absolute bg-black/55"
              style={{
                top: scaledRegion.y + scaledRegion.height,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />
            {/* Left */}
            <div
              className="absolute bg-black/55"
              style={{
                top: scaledRegion.y,
                left: 0,
                width: scaledRegion.x,
                height: scaledRegion.height,
              }}
            />
            {/* Right */}
            <div
              className="absolute bg-black/55"
              style={{
                top: scaledRegion.y,
                left: scaledRegion.x + scaledRegion.width,
                right: 0,
                height: scaledRegion.height,
              }}
            />
          </div>

          {/* Selection box */}
          <div
            className="absolute cursor-move focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            tabIndex={0} role="group" aria-label="Capture region. Arrow keys move; Option and arrow keys resize. Shift increases the step."
            onKeyDown={event => {
              if (confirming || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault();
              const step = event.shiftKey ? 10 : 1;
              const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
              const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
              setRegion(previous => event.altKey ? { ...previous,
                width: Math.max(Math.min(MIN_SIZE, screenWidth), Math.min(screenWidth - previous.x, previous.width + dx)),
                height: Math.max(Math.min(MIN_SIZE, screenHeight), Math.min(screenHeight - previous.y, previous.height + dy)),
              } : { ...previous,
                x: Math.max(0, Math.min(screenWidth - previous.width, previous.x + dx)),
                y: Math.max(0, Math.min(screenHeight - previous.height, previous.y + dy)),
              });
            }}
            style={{
              left: scaledRegion.x,
              top: scaledRegion.y,
              width: scaledRegion.width,
              height: scaledRegion.height,
            }}
            onPointerDown={(e) => handlePointerDown(e, "drag")}
          >
            {/* Record-color border, 1.5px */}
            <div
              className="absolute inset-0 rounded-sm pointer-events-none"
              style={{
                boxShadow: "inset 0 0 0 1.5px hsl(var(--record))",
              }}
            />

            {/* Corner handles — 9px white circles */}
            {/* NW */}
            <div
              className="absolute -top-3 -left-3 w-6 h-6 flex items-center justify-center cursor-nw-resize"
              onPointerDown={(e) => handlePointerDown(e, "nw")}
            >
              <div className={`w-[9px] h-[9px] rounded-full bg-white ${handleShadow}`} />
            </div>
            {/* NE */}
            <div
              className="absolute -top-3 -right-3 w-6 h-6 flex items-center justify-center cursor-ne-resize"
              onPointerDown={(e) => handlePointerDown(e, "ne")}
            >
              <div className={`w-[9px] h-[9px] rounded-full bg-white ${handleShadow}`} />
            </div>
            {/* SW */}
            <div
              className="absolute -bottom-3 -left-3 w-6 h-6 flex items-center justify-center cursor-sw-resize"
              onPointerDown={(e) => handlePointerDown(e, "sw")}
            >
              <div className={`w-[9px] h-[9px] rounded-full bg-white ${handleShadow}`} />
            </div>
            {/* SE */}
            <div
              className="absolute -bottom-3 -right-3 w-6 h-6 flex items-center justify-center cursor-se-resize"
              onPointerDown={(e) => handlePointerDown(e, "se")}
            >
              <div className={`w-[9px] h-[9px] rounded-full bg-white ${handleShadow}`} />
            </div>

            {/* Edge handles — 14×6 / 6×14 white capsules */}
            {/* N */}
            <div
              className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 flex items-center justify-center cursor-n-resize"
              onPointerDown={(e) => handlePointerDown(e, "n")}
            >
              <div className={`w-3.5 h-1.5 rounded-full bg-white ${handleShadow}`} />
            </div>
            {/* S */}
            <div
              className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 flex items-center justify-center cursor-s-resize"
              onPointerDown={(e) => handlePointerDown(e, "s")}
            >
              <div className={`w-3.5 h-1.5 rounded-full bg-white ${handleShadow}`} />
            </div>
            {/* W */}
            <div
              className="absolute top-1/2 -left-3 -translate-y-1/2 w-6 h-6 flex items-center justify-center cursor-w-resize"
              onPointerDown={(e) => handlePointerDown(e, "w")}
            >
              <div className={`w-1.5 h-3.5 rounded-full bg-white ${handleShadow}`} />
            </div>
            {/* E */}
            <div
              className="absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-6 flex items-center justify-center cursor-e-resize"
              onPointerDown={(e) => handlePointerDown(e, "e")}
            >
              <div className={`w-1.5 h-3.5 rounded-full bg-white ${handleShadow}`} />
            </div>
          </div>

          {/* Dimension label — below the selection box */}
          <div
            className="absolute mat-hud rounded-md text-micro font-mono px-1.5 py-0.5"
            style={{
              left: scaledRegion.x + scaledRegion.width / 2,
              top: scaledRegion.y + scaledRegion.height + 8,
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }}
          >
            {Math.round(region.width)} × {Math.round(region.height)}
          </div>
        </div>

        {previewError && <p className="max-w-[min(600px,calc(100vw-48px))] rounded-lg mat-hud p-2 text-callout text-white" role="status">{previewError}</p>}
        {/* Controls bar */}
        <div className="mat-hud rounded-xl p-1.5 flex flex-wrap justify-center items-center gap-1.5 max-w-[calc(100vw-32px)]">
          {onRefreshPreview && <Button variant="hud" size="sm" aria-disabled={previewLoading || confirming} className="aria-disabled:opacity-40"
            onClick={() => { if (!previewLoading && !confirming) onRefreshPreview(); }}>
            {previewLoading ? <Loader2 className="motion-safe:animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Refresh Preview
          </Button>}
          {onOpenSettings && <Button variant="hud" size="sm" onClick={onOpenSettings}>Open System Settings</Button>}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="hud" size="sm" onClick={onClose} disabled={confirming} aria-label="Cancel">
                <X className="h-4 w-4 mr-1.5" />
                Cancel
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cancel</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="hud"
                size="sm"
                aria-label="Full Screen"
                disabled={confirming}
                onClick={() =>
                  setRegion({ x: 0, y: 0, width: screenWidth, height: screenHeight })
                }
              >
                <Maximize2 className="h-4 w-4 mr-1.5" />
                Full Screen
              </Button>
            </TooltipTrigger>
            <TooltipContent>Select entire screen</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="record" size="sm" onClick={handleConfirm} disabled={confirming} aria-label="Confirm Region">
                {confirming ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4 mr-1.5" />}
                Confirm Region
              </Button>
            </TooltipTrigger>
            <TooltipContent>Confirm Region</TooltipContent>
          </Tooltip>
        </div>

        {/* Position/size readout */}
        <p className="text-caption font-mono text-white/50">
          Position: ({Math.round(region.x)}, {Math.round(region.y)}) |{" "}
          Size: {Math.round(region.width)} × {Math.round(region.height)}
        </p>
      </div>
    </DialogPrimitive.Content>
    </DialogPortal>
    </Dialog>
  );
}
