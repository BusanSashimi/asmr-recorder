import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Volume2,
  VolumeX,
  Plus,
  Monitor,
  Camera,
  X,
  Crop,
} from "lucide-react";
import { RecordModal } from "./record-modal";
import { CameraSelectModal } from "./camera-select-modal";
import { RegionSelector } from "./region-selector";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { RecordingCanvas } from "./recording-canvas";
import { useRecordingContext } from "@/contexts/recording-context";
import { toast } from "@/hooks/use-toast";
import { hasMediaApi } from "@/lib/utils";
import { computeSlots } from "@/lib/layouts";
import {
  startNativeScreenStream,
  stopNativeScreenStream,
  listDisplays,
  type DisplayInfo,
} from "@/lib/native-screen";
import type { Channel } from "@tauri-apps/api/core";
import type { ScreenRegion } from "@/types/recording";

interface PreviewProps {
  isRecording?: boolean;
  captureScreen?: boolean;
  captureWebcam?: boolean;
  captureMic?: boolean;
}

interface SectionVideoRef {
  [key: number]: HTMLVideoElement | null;
}

interface SectionCanvasRef {
  [key: number]: HTMLCanvasElement | null;
}

interface SectionRegion {
  [key: number]: ScreenRegion | null;
}

interface SectionSourceVideo {
  [key: number]: HTMLVideoElement | null;
}

export function Preview({ isRecording = false }: PreviewProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showRegionSelector, setShowRegionSelector] = useState(false);
  const [selectedSection, setSelectedSection] = useState<number>(0);
  const [pendingStream, setPendingStream] = useState<MediaStream | null>(null);
  const [screenDimensions, setScreenDimensions] = useState({
    width: 1920,
    height: 1080,
  });
  const [showDisplayPicker, setShowDisplayPicker] = useState(false);
  const [availableDisplays, setAvailableDisplays] = useState<DisplayInfo[]>([]);
  // Tracks a pending native-screen region selection (index + chosen display).
  // Set before opening RegionSelector for the native path; cleared on confirm/cancel.
  const nativeRegionPendingRef = useRef<{ index: number; displayIndex: number } | null>(null);

  const videoRefs = useRef<SectionVideoRef>({});
  const canvasRefs = useRef<SectionCanvasRef>({});
  const sectionRegions = useRef<SectionRegion>({});
  const sourceVideos = useRef<SectionSourceVideo>({});
  const animationFrames = useRef<{ [key: number]: number }>({});
  // Native screen capture (WKWebView has no getDisplayMedia): a per-section
  // Tauri Channel streaming JPEG frames, drawn into a per-section canvas.
  const nativeScreenChannels = useRef<{
    [key: number]: Channel<ArrayBuffer> | null;
  }>({});
  const nativeCanvasRefs = useRef<SectionCanvasRef>({});

  const {
    sectionState,
    setSectionSource,
    setSectionStream,
    clearSection,
    setActiveSectionIndex,
    externalConfig,
    isExternalRecording,
    setRecordingAnalysers,
  } = useRecordingContext();

  // Build section sources for RecordingCanvas
  type SectionSourceType = {
    type: "video" | "canvas" | null;
    element: HTMLVideoElement | HTMLCanvasElement | null;
    region?: ScreenRegion | null;
  };

  // Build section sources - recalculates when sections change
  // Note: We use a getter function pattern so RecordingCanvas always gets fresh refs
  const getSectionSources = useCallback((): [SectionSourceType, SectionSourceType, SectionSourceType, SectionSourceType] => {
    const sources = sectionState.sections.map((section, index): SectionSourceType => {
      const hasRegion = section.source === "screen" && sectionRegions.current[index];

      if (section.source === null) {
        return { type: null, element: null };
      }

      // Native screen capture: the canvas is fed JPEG frames from the backend
      // Channel. Takes priority over the browser-screen/region paths below.
      if (nativeScreenChannels.current[index]) {
        return {
          type: "canvas",
          element: nativeCanvasRefs.current[index] || null,
        };
      }

      if (hasRegion) {
        // Cropped screen capture: hand RecordingCanvas the live source <video>
        // plus the crop region so it draws the region directly (9-arg
        // drawImage), instead of reading the rAF-fed intermediate canvas. The
        // on-screen preview still uses that canvas (canvasRefs); this only
        // changes the recording source. Fall back to the canvas if the source
        // video isn't available so the section never goes blank.
        const sourceVideo = sourceVideos.current[index];
        if (sourceVideo) {
          return {
            type: "video",
            element: sourceVideo,
            region: sectionRegions.current[index],
          };
        }
        return {
          type: "canvas",
          element: canvasRefs.current[index] || null,
          region: sectionRegions.current[index],
        };
      } else if (section.source === "camera") {
        // Camera: use the hidden video element that has the camera stream.
        return {
          type: "video",
          element: sourceVideos.current[index] || null,
        };
      } else {
        // Full-screen browser capture (no region crop)
        return {
          type: "video",
          element: videoRefs.current[index] || null,
        };
      }
    });
    return sources as [SectionSourceType, SectionSourceType, SectionSourceType, SectionSourceType];
  }, [sectionState.sections]);

  // Memoized initial value for RecordingCanvas
  const sectionSources = useMemo(() => getSectionSources(), [getSectionSources]);

  // Handle frame capture errors
  const handleFrameError = useCallback((error: string) => {
    console.error("Frame capture error:", error);
    toast({
      title: "Recording error",
      description: error,
      variant: "destructive",
    });
  }, []);

  // Check if any section has content
  const hasContent = sectionState.sections.some(
    (section) => section.source !== null
  );

  // Update video elements when streams change
  useEffect(() => {
    sectionState.sections.forEach((section, index) => {
      const videoEl = videoRefs.current[index];
      if (videoEl && section.stream) {
        videoEl.srcObject = section.stream;
      } else if (videoEl && !section.stream) {
        videoEl.srcObject = null;
      }
    });
  }, [sectionState.sections]);

  const handleSectionClick = (index: number) => {
    setSelectedSection(index);
    setActiveSectionIndex(index);
    setShowRecordModal(true);
  };

  const handleRecordOption = async (option: "screen" | "camera") => {
    if (option === "screen") {
      // Browser screen capture (getDisplayMedia) is unavailable in WKWebView, so
      // use the native ScreenCaptureKit stream there; keep the browser path (with
      // region selection) where getDisplayMedia actually exists.
      if (hasMediaApi("getDisplayMedia")) {
        await startScreenCapture();
      } else {
        await startNativeScreen(selectedSection);
      }
    } else {
      setShowCameraModal(true);
    }
  };

  // Tear down any native screen stream on a section (backend stream + refs), so
  // switching a native-screen section to a camera/region doesn't leak the
  // SCStream/worker or pin the section to its stale native canvas.
  const stopNativeStreamForSection = useCallback((index: number) => {
    if (nativeScreenChannels.current[index]) {
      stopNativeScreenStream(index);
      nativeScreenChannels.current[index] = null;
      nativeCanvasRefs.current[index] = null;
      sectionRegions.current[index] = null;
    }
  }, []);

  // Start native screen capture for a section (WKWebView path).
  // Shows a display picker when >1 display exists, then opens RegionSelector
  // so the user can choose a crop. The actual stream starts in handleRegionConfirm.
  const startNativeScreen = useCallback(
    async (index: number) => {
      try {
        const displays = await listDisplays();
        if (displays.length > 1) {
          setAvailableDisplays(displays);
          nativeRegionPendingRef.current = { index, displayIndex: 0 };
          setShowDisplayPicker(true);
        } else {
          const d = displays[0] ?? { width: 1920, height: 1080 };
          nativeRegionPendingRef.current = { index, displayIndex: 0 };
          setScreenDimensions({ width: d.width, height: d.height });
          setShowRegionSelector(true);
        }
      } catch (err) {
        toast({
          title: "Screen capture failed",
          description: String(err),
          variant: "destructive",
        });
      }
    },
    [],
  );

  const handleDisplayConfirm = useCallback(
    (displayIndex: number) => {
      if (!nativeRegionPendingRef.current) return;
      nativeRegionPendingRef.current = { ...nativeRegionPendingRef.current, displayIndex };
      const display = availableDisplays[displayIndex];
      if (display) {
        setScreenDimensions({ width: display.width, height: display.height });
      }
      setShowDisplayPicker(false);
      setShowRegionSelector(true);
    },
    [availableDisplays],
  );

  const handleDisplayPickerClose = useCallback(() => {
    nativeRegionPendingRef.current = null;
    setShowDisplayPicker(false);
  }, []);

  // Start canvas rendering loop for cropped video
  const startCanvasRendering = useCallback(
    (sectionIndex: number, video: HTMLVideoElement, region: ScreenRegion) => {
      const canvas = canvasRefs.current[sectionIndex];
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Set canvas size to match region
      canvas.width = region.width;
      canvas.height = region.height;

      const render = () => {
        if (video.readyState >= video.HAVE_CURRENT_DATA) {
          // Draw the cropped region of the video
          ctx.drawImage(
            video,
            region.x,
            region.y,
            region.width,
            region.height, // Source rectangle
            0,
            0,
            region.width,
            region.height // Destination rectangle
          );
        }
        animationFrames.current[sectionIndex] = requestAnimationFrame(render);
      };

      render();
    },
    []
  );

  // Stop canvas rendering for a section
  const stopCanvasRendering = useCallback((sectionIndex: number) => {
    if (animationFrames.current[sectionIndex]) {
      cancelAnimationFrame(animationFrames.current[sectionIndex]);
      delete animationFrames.current[sectionIndex];
    }
    if (sourceVideos.current[sectionIndex]) {
      sourceVideos.current[sectionIndex]?.pause();
      sourceVideos.current[sectionIndex] = null;
    }
  }, []);

  const startScreenCapture = useCallback(async () => {
    if (!hasMediaApi("getDisplayMedia")) {
      toast({
        title: "Screen capture unavailable",
        description:
          "This webview can't use browser screen capture (getDisplayMedia). The desktop app needs native screen capture.",
        variant: "destructive",
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
        },
        audio: false,
      });

      // Get video dimensions from the track
      const videoTrack = stream.getVideoTracks()[0];
      const settings = videoTrack.getSettings();
      const width = settings.width || 1920;
      const height = settings.height || 1080;

      setScreenDimensions({ width, height });
      setPendingStream(stream);
      setShowRegionSelector(true);
    } catch (err) {
      if ((err as Error).name === "NotAllowedError") {
        toast({
          title: "Permission denied",
          description: "Screen capture was cancelled or denied",
          variant: "destructive",
        });
      } else {
        console.error("Screen capture error:", err);
        toast({
          title: "Screen capture failed",
          description: String(err),
          variant: "destructive",
        });
      }
    }
  }, []);

  const handleRegionConfirm = useCallback(
    (region: ScreenRegion) => {
      // Native path: RegionSelector was opened by startNativeScreen
      if (nativeRegionPendingRef.current) {
        const { index, displayIndex } = nativeRegionPendingRef.current;
        nativeRegionPendingRef.current = null;
        stopNativeStreamForSection(index);
        sectionRegions.current[index] = region;
        const regionLabel =
          region.width === screenDimensions.width && region.height === screenDimensions.height
            ? "Full Screen"
            : `Region (${region.width}×${region.height})`;
        startNativeScreenStream(
          index,
          (bitmap) => {
            const canvas = nativeCanvasRefs.current[index];
            if (!canvas) { bitmap.close(); return; }
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            const ctx = canvas.getContext("2d");
            if (ctx) ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
          },
          {
            displayIndex,
            region,
            fps: externalConfig.frameRate || 30,
            maxDimension: Math.ceil(externalConfig.outputWidth / 2),
          },
        ).then((channel) => {
          nativeScreenChannels.current[index] = channel;
          setSectionSource(index, "screen", undefined, regionLabel);
          toast({
            title: "Screen capture started",
            description: `Native ${regionLabel.toLowerCase()} in section ${index + 1}`,
          });
        }).catch((err: unknown) => {
          sectionRegions.current[index] = null;
          toast({
            title: "Screen capture failed",
            description: String(err),
            variant: "destructive",
          });
        });
        setShowRegionSelector(false);
        return;
      }

      // Browser path
      if (!pendingStream) return;

      const sectionIndex = selectedSection;

      // If this section was a native screen stream, tear it down first.
      stopNativeStreamForSection(sectionIndex);

      // Store the region for this section
      sectionRegions.current[sectionIndex] = region;

      // Create a hidden video element for the source stream
      const sourceVideo = document.createElement("video");
      sourceVideo.srcObject = pendingStream;
      sourceVideo.autoplay = true;
      sourceVideo.muted = true;
      sourceVideo.playsInline = true;
      sourceVideos.current[sectionIndex] = sourceVideo;

      // Handle stream ending
      pendingStream.getVideoTracks()[0].onended = () => {
        stopCanvasRendering(sectionIndex);
        sectionRegions.current[sectionIndex] = null;
        clearSection(sectionIndex);
        toast({
          title: "Screen sharing stopped",
          description: `Section ${sectionIndex + 1} cleared`,
        });
      };

      // Wait for video to be ready, then start rendering
      sourceVideo.onloadedmetadata = () => {
        sourceVideo.play();
        startCanvasRendering(sectionIndex, sourceVideo, region);
      };

      const regionLabel =
        region.width === screenDimensions.width &&
        region.height === screenDimensions.height
          ? "Full Screen"
          : `Region (${region.width}×${region.height})`;

      setSectionSource(sectionIndex, "screen", undefined, regionLabel);
      setSectionStream(sectionIndex, pendingStream);

      toast({
        title: "Screen capture started",
        description: `Recording ${regionLabel.toLowerCase()} to section ${
          sectionIndex + 1
        }`,
      });

      setShowRegionSelector(false);
      setPendingStream(null);
    },
    [
      pendingStream,
      selectedSection,
      screenDimensions,
      externalConfig.frameRate,
      externalConfig.outputWidth,
      setSectionSource,
      setSectionStream,
      clearSection,
      startCanvasRendering,
      stopCanvasRendering,
      stopNativeStreamForSection,
    ]
  );

  const handleRegionCancel = useCallback(() => {
    nativeRegionPendingRef.current = null;
    if (pendingStream) {
      pendingStream.getTracks().forEach((track) => track.stop());
      setPendingStream(null);
    }
    setShowRegionSelector(false);
  }, [pendingStream]);

  const handleCameraSelect = (
    deviceId: string,
    deviceName: string,
    stream: MediaStream
  ) => {
    // If this section was a native screen stream, tear it down first so it
    // doesn't keep running and masking the camera in the composite.
    stopNativeStreamForSection(selectedSection);

    // Hidden video element for the recording canvas (mirrors the screen path).
    const sourceVideo = document.createElement("video");
    sourceVideo.srcObject = stream;
    sourceVideo.autoplay = true;
    sourceVideo.muted = true;
    sourceVideo.playsInline = true;
    sourceVideos.current[selectedSection] = sourceVideo;

    // Handle stream ending
    stream.getVideoTracks()[0].onended = () => {
      sourceVideos.current[selectedSection] = null;
      clearSection(selectedSection);
      toast({
        title: "Camera disconnected",
        description: `Section ${selectedSection + 1} cleared`,
      });
    };

    setSectionSource(selectedSection, "camera", deviceId, deviceName);
    setSectionStream(selectedSection, stream);

    toast({
      title: "Camera connected",
      description: `${deviceName} assigned to section ${selectedSection + 1}`,
    });
  };

  const handleClearSection = (index: number) => {
    // Stop canvas rendering if it was a screen capture with region
    stopCanvasRendering(index);
    sectionRegions.current[index] = null;
    videoRefs.current[index] = null;
    sourceVideos.current[index] = null;

    // Stop native screen stream if this section had one
    stopNativeStreamForSection(index);

    clearSection(index);
    toast({
      title: "Section cleared",
      description: `Section ${index + 1} has been cleared`,
    });
  };

  // Attach camera streams to their on-screen <video> elements after each
  // section-state update. The ref isn't set until after the re-render that
  // follows setSectionSource, so a useEffect is the right hook.
  useEffect(() => {
    sectionState.sections.forEach((section, index) => {
      const videoEl = videoRefs.current[index];
      if (videoEl && section.source === "camera" && section.stream) {
        if (videoEl.srcObject !== section.stream) {
          videoEl.srcObject = section.stream;
        }
      }
    });
  }, [sectionState.sections]);

  // Cleanup on unmount
  useEffect(() => {
    const channels = nativeScreenChannels.current;
    const frames = animationFrames.current;
    return () => {
      // Stop all canvas rendering
      Object.keys(frames).forEach((key) => {
        cancelAnimationFrame(frames[parseInt(key)]);
      });
      // Stop all native screen streams
      Object.keys(channels).forEach((key) => {
        if (channels[parseInt(key)]) {
          stopNativeScreenStream(parseInt(key));
          channels[parseInt(key)] = null;
        }
      });
    };
  }, []);

  const toggleMute = () => {
    setIsMuted(!isMuted);
    // Apply mute to all video elements
    Object.values(videoRefs.current).forEach((videoEl) => {
      if (videoEl) {
        videoEl.muted = !isMuted;
      }
    });
  };

  const renderSectionContent = (index: number) => {
    const section = sectionState.sections[index];
    const hasRegion =
      section.source === "screen" && sectionRegions.current[index];
    const isNativeScreen = !!nativeScreenChannels.current[index];

    if (section.source === null) {
      // Empty section — dashed slot with add prompt
      return (
        <button
          onClick={() => handleSectionClick(index)}
          className="w-full h-full flex flex-col items-center justify-center border border-dashed border-white/15 rounded-lg hover:bg-white/[.04] motion-safe:active:scale-[0.98] transition-[transform,background-color] duration-100 ease-out"
        >
          <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center mb-2">
            <Plus className="h-5 w-5 text-white/60" />
          </div>
          <span className="text-body text-white/80">Add Source</span>
          <span className="text-caption text-white/45 mt-0.5">Section {index + 1}</span>
        </button>
      );
    }

    // Section has content — show video feed or canvas (for cropped screen)
    return (
      <div className="relative w-full h-full rounded-lg overflow-hidden group">
        {/* Native screen capture canvas (WKWebView path, fed by JPEG frames) */}
        {isNativeScreen && (
          <canvas
            ref={(el) => {
              nativeCanvasRefs.current[index] = el;
            }}
            className="w-full h-full object-contain bg-black"
          />
        )}

        {/* Canvas for cropped browser screen capture */}
        {!isNativeScreen && hasRegion && (
          <canvas
            ref={(el) => {
              canvasRefs.current[index] = el;
            }}
            className="w-full h-full object-contain bg-black"
          />
        )}

        {/* Video feed (for camera or full-screen capture without region) */}
        {!isNativeScreen && !hasRegion && (
          <video
            ref={(el) => {
              videoRefs.current[index] = el;
            }}
            autoPlay
            playsInline
            muted={isMuted}
            className="w-full h-full object-cover bg-black"
          />
        )}

        {/* Source badge — bottom-left */}
        <div className="absolute bottom-2 left-2 mat-hud rounded-full h-6 px-2 text-caption flex items-center gap-1.5">
          {section.source === "screen" ? (
            hasRegion ? (
              <Crop className="h-3 w-3" />
            ) : (
              <Monitor className="h-3 w-3" />
            )
          ) : (
            <Camera className="h-3 w-3" />
          )}
          <span className="truncate max-w-[100px]">
            {section.deviceName ||
              (section.source === "screen" ? "Screen" : "Camera")}
          </span>
        </div>

        {/* Region size badge — top-right */}
        {hasRegion && sectionRegions.current[index] && (
          <div className="absolute top-2 right-2 mat-hud rounded-sm text-micro uppercase font-mono px-1.5 py-0.5">
            {sectionRegions.current[index]!.width}×
            {sectionRegions.current[index]!.height}
          </div>
        )}

        {/* Hover controls veil */}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <Button
            variant="hud"
            size="sm"
            onClick={() => handleSectionClick(index)}
          >
            Change
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="hud"
                size="icon-sm"
                aria-label="Remove source"
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearSection(index);
                }}
              >
                <X />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove source</TooltipContent>
          </Tooltip>
        </div>

        {/* Recording inset ring */}
        {isRecording && (
          <div className="absolute inset-0 rounded-lg pointer-events-none ring-2 ring-inset ring-record/80" />
        )}
      </div>
    );
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex items-center justify-center p-4 [container-type:size]">
        {/* Stage card — 16:9, always fits within its flex parent */}
        <div
          className="relative bg-stage rounded-xl overflow-hidden shadow-[0_1px_2px_hsl(0_0%_0%/.2),0_8px_24px_-8px_hsl(0_0%_0%/.3)] ring-1 ring-black/5"
          style={{
            width: "min(100cqw, calc(100cqh * 16 / 9))",
            aspectRatio: "16 / 9",
          }}
        >
          {/* Layout slots — geometry driven by computeSlots so preview matches recording exactly */}
          {computeSlots(externalConfig.layout, {
            pipPosition: externalConfig.pipPosition,
            pipSize: externalConfig.pipSize,
          }).map((slot, i) => (
            <div
              key={`${slot.section}-${i}`}
              style={{
                position: "absolute",
                left: `${slot.x * 100}%`,
                top: `${slot.y * 100}%`,
                width: `${slot.w * 100}%`,
                height: `${slot.h * 100}%`,
                zIndex: i + 1,
                padding: externalConfig.layout === "grid-2x2" ? 2 : 0,
                boxSizing: "border-box",
              }}
            >
              {renderSectionContent(slot.section)}
            </div>
          ))}

          {/* Bottom HUD capsule — mute + status */}
          {hasContent && (
            <div className="absolute bottom-3 right-3 mat-hud rounded-full h-7 px-1 flex items-center gap-1.5 z-10">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="hud"
                    size="icon-sm"
                    aria-label={isMuted ? "Unmute preview" : "Mute preview"}
                    onClick={toggleMute}
                  >
                    {isMuted ? <VolumeX /> : <Volume2 />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isMuted ? "Unmute preview" : "Mute preview"}
                </TooltipContent>
              </Tooltip>
              <span className="text-caption pr-1 whitespace-nowrap">
                {isRecording
                  ? "Recording · Preview is reduced while recording"
                  : "Ready"}
              </span>
            </div>
          )}
        </div>

        {/* Record Modal — Screen/Camera selection */}
        <RecordModal
          open={showRecordModal}
          onOpenChange={setShowRecordModal}
          onSelectOption={handleRecordOption}
          sectionIndex={selectedSection}
          hasExistingSource={
            sectionState.sections[selectedSection]?.source !== null
          }
          onClear={() => handleClearSection(selectedSection)}
        />

        {/* Camera Selection Modal */}
        <CameraSelectModal
          open={showCameraModal}
          onOpenChange={setShowCameraModal}
          onSelectCamera={handleCameraSelect}
          sectionIndex={selectedSection}
        />

        {/* Display picker — shown when >1 display is available (native path only) */}
        <Dialog
          open={showDisplayPicker}
          onOpenChange={(open) => { if (!open) handleDisplayPickerClose(); }}
        >
          <DialogContent className="max-w-[320px]">
            <DialogHeader>
              <DialogTitle>Select Display</DialogTitle>
              <DialogDescription>Choose which display to capture.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-0.5">
              {availableDisplays.map((display, i) => (
                <button
                  key={display.displayId}
                  className="flex items-center h-8 rounded-md px-2 text-body hover:bg-fill transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  onClick={() => handleDisplayConfirm(i)}
                >
                  <span className="flex-1 text-left">
                    {display.isPrimary ? "Primary Display" : `Display ${i + 1}`}
                  </span>
                  <span className="text-caption tabular-nums text-muted-foreground">
                    {display.width}×{display.height}
                  </span>
                </button>
              ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Region Selector Overlay */}
        <RegionSelector
          open={showRegionSelector}
          onClose={handleRegionCancel}
          onConfirm={handleRegionConfirm}
          screenWidth={screenDimensions.width}
          screenHeight={screenDimensions.height}
          stream={pendingStream}
        />

        {/* Recording Canvas — composites sections and sends frames to Tauri */}
        <RecordingCanvas
          outputWidth={externalConfig.outputWidth}
          outputHeight={externalConfig.outputHeight}
          frameRate={externalConfig.frameRate || 30}
          isRecording={isExternalRecording}
          onFrameError={handleFrameError}
          sectionSources={sectionSources}
          getSectionSources={getSectionSources}
          captureMic={externalConfig.captureMic}
          micDeviceId={externalConfig.micDeviceId}
          captureSystemAudio={externalConfig.captureSystemAudio}
          systemAudioApp={externalConfig.systemAudioApp}
          micGain={externalConfig.micGain}
          micHighpass={externalConfig.micHighpass}
          micMuted={externalConfig.micMuted}
          systemAudioGain={externalConfig.systemAudioGain}
          systemAudioMuted={externalConfig.systemAudioMuted}
          layout={externalConfig.layout}
          pipPosition={externalConfig.pipPosition}
          pipSize={externalConfig.pipSize}
          videoQuality={externalConfig.videoQuality}
          onAnalysersChanged={setRecordingAnalysers}
        />
      </div>
  );
}
