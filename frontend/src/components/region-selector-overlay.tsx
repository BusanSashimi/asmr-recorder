import { useState, useRef, useCallback, useEffect } from "react";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Check, X, Move, Maximize2 } from "lucide-react";

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SIZE = 100;

export function RegionSelectorOverlay() {
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  // Default to center region (50% of screen)
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, action: "drag" | string) => {
      e.preventDefault();
      e.stopPropagation();

      setDragStart({ x: e.clientX, y: e.clientY });
      setRegionStart({ ...region });

      if (action === "drag") {
        setIsDragging(true);
      } else {
        setIsResizing(action);
      }
    },
    [region]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging && !isResizing) return;

      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;

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
        newRegion.height = Math.min(
          screenHeight - newRegion.y,
          newRegion.height
        );

        setRegion(newRegion);
      }
    },
    [
      isDragging,
      isResizing,
      dragStart,
      regionStart,
      screenWidth,
      screenHeight,
    ]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setIsResizing(null);
  }, []);

  // Global mouse listeners
  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      } else if (e.key === "Enter") {
        handleConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [region]);

  const handleConfirm = async () => {
    const finalRegion = {
      x: Math.round(region.x),
      y: Math.round(region.y),
      width: Math.round(region.width),
      height: Math.round(region.height),
    };

    // Emit the region selection event to the main window
    await emit("region-selected", finalRegion);

    // Close this window
    await invoke("close_region_selector");
  };

  const handleCancel = async () => {
    // Emit cancel event
    await emit("region-cancelled", {});

    // Close this window
    await invoke("close_region_selector");
  };

  const handleFullScreen = () => {
    setRegion({ x: 0, y: 0, width: screenWidth, height: screenHeight });
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 cursor-crosshair select-none"
      style={{ backgroundColor: "transparent" }}
    >
      {/* Semi-transparent overlay outside the selection */}
      {/* Top */}
      <div
        className="absolute bg-black/50 pointer-events-none"
        style={{
          top: 0,
          left: 0,
          right: 0,
          height: region.y,
        }}
      />
      {/* Bottom */}
      <div
        className="absolute bg-black/50 pointer-events-none"
        style={{
          top: region.y + region.height,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
      {/* Left */}
      <div
        className="absolute bg-black/50 pointer-events-none"
        style={{
          top: region.y,
          left: 0,
          width: region.x,
          height: region.height,
        }}
      />
      {/* Right */}
      <div
        className="absolute bg-black/50 pointer-events-none"
        style={{
          top: region.y,
          left: region.x + region.width,
          right: 0,
          height: region.height,
        }}
      />

      {/* Selection box */}
      <div
        className="absolute cursor-move"
        style={{
          left: region.x,
          top: region.y,
          width: region.width,
          height: region.height,
        }}
        onMouseDown={(e) => handleMouseDown(e, "drag")}
      >
        {/* Red border */}
        <div className="absolute inset-0 border-2 border-red-500 pointer-events-none" />

        {/* Dashed inner guide */}
        <div className="absolute inset-2 border border-dashed border-red-500/50 pointer-events-none" />

        {/* Center crosshair */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Move className="h-8 w-8 text-red-500/30" />
        </div>

        {/* Resize handles - Corners */}
        <div
          className="absolute -top-2 -left-2 w-4 h-4 bg-red-500 rounded-sm cursor-nw-resize hover:bg-red-400 transition-colors border border-white"
          onMouseDown={(e) => handleMouseDown(e, "nw")}
        />
        <div
          className="absolute -top-2 -right-2 w-4 h-4 bg-red-500 rounded-sm cursor-ne-resize hover:bg-red-400 transition-colors border border-white"
          onMouseDown={(e) => handleMouseDown(e, "ne")}
        />
        <div
          className="absolute -bottom-2 -left-2 w-4 h-4 bg-red-500 rounded-sm cursor-sw-resize hover:bg-red-400 transition-colors border border-white"
          onMouseDown={(e) => handleMouseDown(e, "sw")}
        />
        <div
          className="absolute -bottom-2 -right-2 w-4 h-4 bg-red-500 rounded-sm cursor-se-resize hover:bg-red-400 transition-colors border border-white"
          onMouseDown={(e) => handleMouseDown(e, "se")}
        />

        {/* Resize handles - Edges */}
        <div
          className="absolute -top-2 left-1/2 -translate-x-1/2 w-8 h-4 bg-red-500 rounded-sm cursor-n-resize hover:bg-red-400 transition-colors border border-white"
          onMouseDown={(e) => handleMouseDown(e, "n")}
        />
        <div
          className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-4 bg-red-500 rounded-sm cursor-s-resize hover:bg-red-400 transition-colors border border-white"
          onMouseDown={(e) => handleMouseDown(e, "s")}
        />
        <div
          className="absolute top-1/2 -left-2 -translate-y-1/2 w-4 h-8 bg-red-500 rounded-sm cursor-w-resize hover:bg-red-400 transition-colors border border-white"
          onMouseDown={(e) => handleMouseDown(e, "w")}
        />
        <div
          className="absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-8 bg-red-500 rounded-sm cursor-e-resize hover:bg-red-400 transition-colors border border-white"
          onMouseDown={(e) => handleMouseDown(e, "e")}
        />
      </div>

      {/* Dimension label - below selection */}
      <div
        className="absolute bg-red-500 text-white text-sm px-3 py-1.5 rounded font-mono shadow-lg"
        style={{
          left: region.x + region.width / 2,
          top: region.y + region.height + 12,
          transform: "translateX(-50%)",
        }}
      >
        {Math.round(region.width)} × {Math.round(region.height)}
      </div>

      {/* Controls - Fixed at bottom center */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/80 backdrop-blur-sm rounded-lg px-4 py-3 shadow-2xl">
        <button
          onClick={handleCancel}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
        >
          <X className="h-4 w-4" />
          Cancel
        </button>

        <button
          onClick={handleFullScreen}
          className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md transition-colors"
        >
          <Maximize2 className="h-4 w-4" />
          Full Screen
        </button>

        <button
          onClick={handleConfirm}
          className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-md transition-colors"
        >
          <Check className="h-4 w-4" />
          Confirm
        </button>
      </div>

      {/* Info panel - Fixed at top center */}
      <div className="fixed top-8 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-sm rounded-lg px-4 py-2 shadow-2xl">
        <p className="text-white text-sm">
          Drag to move · Resize from corners/edges · Press{" "}
          <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-xs">Enter</kbd>{" "}
          to confirm ·{" "}
          <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-xs">Esc</kbd>{" "}
          to cancel
        </p>
      </div>

      {/* Position info */}
      <div
        className="absolute bg-black/70 text-white text-xs px-2 py-1 rounded font-mono"
        style={{
          left: region.x,
          top: region.y - 24,
        }}
      >
        ({Math.round(region.x)}, {Math.round(region.y)})
      </div>
    </div>
  );
}
