import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Check, X, Move, Maximize2 } from "lucide-react";

interface RegionSelectorProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (region: { x: number; y: number; width: number; height: number }) => void;
  screenWidth?: number;
  screenHeight?: number;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 100;
const HANDLE_SIZE = 12;

export function RegionSelector({
  open,
  onClose,
  onConfirm,
  screenWidth = 1920,
  screenHeight = 1080,
}: RegionSelectorProps) {
  // Default to center region
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Scale factor for preview (fit screen in viewport)
  const scale = Math.min(
    (window.innerWidth - 100) / screenWidth,
    (window.innerHeight - 200) / screenHeight,
    1
  );

  const scaledWidth = screenWidth * scale;
  const scaledHeight = screenHeight * scale;

  const handleMouseDown = useCallback((e: React.MouseEvent, action: "drag" | string) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = (e.clientX - rect.left) / scale;
    const mouseY = (e.clientY - rect.top) / scale;

    setDragStart({ x: mouseX, y: mouseY });
    setRegionStart({ ...region });

    if (action === "drag") {
      setIsDragging(true);
    } else {
      setIsResizing(action);
    }
  }, [region, scale]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging && !isResizing) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = (e.clientX - rect.left) / scale;
    const mouseY = (e.clientY - rect.top) / scale;

    const deltaX = mouseX - dragStart.x;
    const deltaY = mouseY - dragStart.y;

    if (isDragging) {
      // Move the region
      let newX = regionStart.x + deltaX;
      let newY = regionStart.y + deltaY;

      // Constrain to screen bounds
      newX = Math.max(0, Math.min(screenWidth - regionStart.width, newX));
      newY = Math.max(0, Math.min(screenHeight - regionStart.height, newY));

      setRegion({
        ...regionStart,
        x: newX,
        y: newY,
      });
    } else if (isResizing) {
      // Resize the region
      let newRegion = { ...regionStart };

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

      // Constrain to screen bounds
      newRegion.x = Math.max(0, newRegion.x);
      newRegion.y = Math.max(0, newRegion.y);
      newRegion.width = Math.min(screenWidth - newRegion.x, newRegion.width);
      newRegion.height = Math.min(screenHeight - newRegion.y, newRegion.height);

      setRegion(newRegion);
    }
  }, [isDragging, isResizing, dragStart, regionStart, scale, screenWidth, screenHeight]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(null);
  }, []);

  // Global mouse up listener
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setIsResizing(null);
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => window.removeEventListener("mouseup", handleGlobalMouseUp);
  }, []);

  const handleConfirm = () => {
    onConfirm({
      x: Math.round(region.x),
      y: Math.round(region.y),
      width: Math.round(region.width),
      height: Math.round(region.height),
    });
  };

  if (!open) return null;

  const scaledRegion = {
    x: region.x * scale,
    y: region.y * scale,
    width: region.width * scale,
    height: region.height * scale,
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        {/* Header */}
        <div className="text-white text-center">
          <h2 className="text-xl font-semibold mb-1">Select Capture Region</h2>
          <p className="text-sm text-white/70">
            Drag to move, resize from corners or edges
          </p>
        </div>

        {/* Screen preview container */}
        <div
          ref={containerRef}
          className="relative bg-gray-900 rounded-lg overflow-hidden shadow-2xl"
          style={{ width: scaledWidth, height: scaledHeight }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Screen background pattern */}
          <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900">
            <div className="absolute inset-0 opacity-10">
              <div className="w-full h-full" style={{
                backgroundImage: `
                  linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
                `,
                backgroundSize: `${50 * scale}px ${50 * scale}px`,
              }} />
            </div>
          </div>

          {/* Darkened areas outside selection */}
          <div className="absolute inset-0 pointer-events-none">
            {/* Top */}
            <div
              className="absolute bg-black/60"
              style={{
                top: 0,
                left: 0,
                right: 0,
                height: scaledRegion.y,
              }}
            />
            {/* Bottom */}
            <div
              className="absolute bg-black/60"
              style={{
                top: scaledRegion.y + scaledRegion.height,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />
            {/* Left */}
            <div
              className="absolute bg-black/60"
              style={{
                top: scaledRegion.y,
                left: 0,
                width: scaledRegion.x,
                height: scaledRegion.height,
              }}
            />
            {/* Right */}
            <div
              className="absolute bg-black/60"
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
            className="absolute cursor-move"
            style={{
              left: scaledRegion.x,
              top: scaledRegion.y,
              width: scaledRegion.width,
              height: scaledRegion.height,
            }}
            onMouseDown={(e) => handleMouseDown(e, "drag")}
          >
            {/* Red border */}
            <div className="absolute inset-0 border-2 border-red-500 rounded pointer-events-none" />
            
            {/* Dashed inner guide */}
            <div className="absolute inset-2 border border-dashed border-red-500/50 rounded pointer-events-none" />

            {/* Center crosshair */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Move className="h-6 w-6 text-red-500/50" />
            </div>

            {/* Resize handles */}
            {/* Corners */}
            <div
              className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-red-500 rounded-sm cursor-nw-resize hover:bg-red-400 transition-colors"
              onMouseDown={(e) => handleMouseDown(e, "nw")}
            />
            <div
              className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-red-500 rounded-sm cursor-ne-resize hover:bg-red-400 transition-colors"
              onMouseDown={(e) => handleMouseDown(e, "ne")}
            />
            <div
              className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-red-500 rounded-sm cursor-sw-resize hover:bg-red-400 transition-colors"
              onMouseDown={(e) => handleMouseDown(e, "sw")}
            />
            <div
              className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-red-500 rounded-sm cursor-se-resize hover:bg-red-400 transition-colors"
              onMouseDown={(e) => handleMouseDown(e, "se")}
            />
            
            {/* Edge handles */}
            <div
              className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-6 h-3 bg-red-500 rounded-sm cursor-n-resize hover:bg-red-400 transition-colors"
              onMouseDown={(e) => handleMouseDown(e, "n")}
            />
            <div
              className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-6 h-3 bg-red-500 rounded-sm cursor-s-resize hover:bg-red-400 transition-colors"
              onMouseDown={(e) => handleMouseDown(e, "s")}
            />
            <div
              className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-6 bg-red-500 rounded-sm cursor-w-resize hover:bg-red-400 transition-colors"
              onMouseDown={(e) => handleMouseDown(e, "w")}
            />
            <div
              className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-6 bg-red-500 rounded-sm cursor-e-resize hover:bg-red-400 transition-colors"
              onMouseDown={(e) => handleMouseDown(e, "e")}
            />
          </div>

          {/* Dimension label */}
          <div
            className="absolute bg-red-500 text-white text-xs px-2 py-1 rounded font-mono"
            style={{
              left: scaledRegion.x + scaledRegion.width / 2,
              top: scaledRegion.y + scaledRegion.height + 8,
              transform: "translateX(-50%)",
            }}
          >
            {Math.round(region.width)} × {Math.round(region.height)}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            className="bg-transparent border-white/20 text-white hover:bg-white/10"
            onClick={onClose}
          >
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          
          <Button
            variant="outline"
            className="bg-transparent border-white/20 text-white hover:bg-white/10"
            onClick={() => setRegion({ x: 0, y: 0, width: screenWidth, height: screenHeight })}
          >
            <Maximize2 className="h-4 w-4 mr-2" />
            Full Screen
          </Button>

          <Button
            className="bg-red-500 hover:bg-red-600 text-white"
            onClick={handleConfirm}
          >
            <Check className="h-4 w-4 mr-2" />
            Confirm Region
          </Button>
        </div>

        {/* Region info */}
        <p className="text-white/50 text-xs font-mono">
          Position: ({Math.round(region.x)}, {Math.round(region.y)}) | 
          Size: {Math.round(region.width)} × {Math.round(region.height)}
        </p>
      </div>
    </div>
  );
}
