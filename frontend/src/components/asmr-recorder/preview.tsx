import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, Pause, Volume2, VolumeX, Mic, Monitor, Camera } from "lucide-react";

interface PreviewProps {
  isRecording?: boolean;
  captureScreen?: boolean;
  captureWebcam?: boolean;
  captureMic?: boolean;
}

export function Preview({
  isRecording = false,
  captureScreen = true,
  captureWebcam = false,
  captureMic = true,
}: PreviewProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [hasContent, setHasContent] = useState(false);

  useEffect(() => {
    const handleTimelinePlayback = (event: CustomEvent) => {
      const { isPlaying: timelinePlaying } = event.detail;
      setIsPlaying(timelinePlaying);
    };

    window.addEventListener("timelinePlayback", handleTimelinePlayback as EventListener);

    return () => {
      window.removeEventListener(
        "timelinePlayback",
        handleTimelinePlayback as EventListener
      );
    };
  }, []);

  // Update hasContent when recording starts
  useEffect(() => {
    if (isRecording) {
      setHasContent(true);
    }
  }, [isRecording]);

  const togglePlay = () => {
    const newPlayingState = !isPlaying;
    setIsPlaying(newPlayingState);

    window.dispatchEvent(
      new CustomEvent("timelinePlayback", {
        detail: { isPlaying: newPlayingState },
      })
    );
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  return (
    <div className="flex-1 p-4 bg-muted/20">
      <Card className="h-full flex items-center justify-center bg-black/90 relative overflow-hidden">
        {/* Preview content */}
        {isRecording ? (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Recording indicator */}
            <div className="text-center text-white">
              <div className="relative">
                {/* Animated rings */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-32 h-32 rounded-full border-4 border-red-500/30 animate-ping" />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-24 h-24 rounded-full border-2 border-red-500/50 animate-pulse" />
                </div>
                
                {/* Center icon */}
                <div className="relative w-20 h-20 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center border-2 border-red-500">
                  <div className="w-4 h-4 rounded-full bg-red-500 animate-pulse" />
                </div>
              </div>
              
              <p className="text-lg font-medium mt-8">Recording in Progress</p>
              
              {/* Active sources indicator */}
              <div className="flex items-center justify-center gap-4 mt-4 text-sm text-white/60">
                {captureScreen && (
                  <div className="flex items-center gap-1">
                    <Monitor className="h-4 w-4" />
                    <span>Screen</span>
                  </div>
                )}
                {captureWebcam && (
                  <div className="flex items-center gap-1">
                    <Camera className="h-4 w-4" />
                    <span>Webcam</span>
                  </div>
                )}
                {captureMic && (
                  <div className="flex items-center gap-1">
                    <Mic className="h-4 w-4" />
                    <span>Mic</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : hasContent ? (
          <div className="absolute inset-0">
            {/* Audio visualization would go here */}
            <div className="w-full h-full flex items-center justify-center">
              <div className="flex items-center gap-1">
                {/* Audio waveform visualization placeholder */}
                {Array.from({ length: 40 }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 bg-primary rounded-full transition-all ${
                      isPlaying ? "animate-pulse" : ""
                    }`}
                    style={{
                      height: `${Math.random() * 60 + 20}px`,
                      animationDelay: `${i * 50}ms`,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center text-white/60">
              <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
                <Mic className="h-10 w-10" />
              </div>
              <p className="text-lg font-medium">Ready to Record</p>
              <p className="text-sm opacity-75 mt-2">
                Configure your sources and click "Record" to start
              </p>
            </div>
          </div>
        )}

        {/* Controls overlay */}
        <div className="absolute bottom-4 left-4 right-4 flex items-center gap-3">
          <Button
            size="sm"
            variant="secondary"
            className="bg-black/50 hover:bg-black/70 text-white border-white/20"
            onClick={togglePlay}
            disabled={!hasContent || isRecording}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>

          <div className="flex-1 h-1 bg-white/20 rounded-full">
            <div
              className={`h-full bg-white rounded-full transition-all ${
                isRecording ? "w-full animate-pulse" : "w-0"
              }`}
            />
          </div>

          <Button
            size="sm"
            variant="secondary"
            className="bg-black/50 hover:bg-black/70 text-white border-white/20"
            onClick={toggleMute}
            disabled={!hasContent}
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>

          <span className="text-white text-sm font-mono">
            {isRecording ? "Recording" : hasContent ? "Ready" : "No Content"}
          </span>
        </div>
      </Card>
    </div>
  );
}
