import { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Play, Pause, Volume2, VolumeX, Mic } from "lucide-react"

export function Preview() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [hasContent, _setHasContent] = useState(false)

  useEffect(() => {
    const handleTimelinePlayback = (event: CustomEvent) => {
      const { isPlaying: timelinePlaying } = event.detail
      setIsPlaying(timelinePlaying)
    }

    window.addEventListener("timelinePlayback", handleTimelinePlayback as EventListener)

    return () => {
      window.removeEventListener("timelinePlayback", handleTimelinePlayback as EventListener)
    }
  }, [])

  const togglePlay = () => {
    const newPlayingState = !isPlaying
    setIsPlaying(newPlayingState)
    
    window.dispatchEvent(
      new CustomEvent("timelinePlayback", {
        detail: { isPlaying: newPlayingState },
      })
    )
  }

  const toggleMute = () => {
    setIsMuted(!isMuted)
  }

  return (
    <div className="flex-1 p-4 bg-muted/20">
      <Card className="h-full flex items-center justify-center bg-black/90 relative overflow-hidden">
        {/* Preview content */}
        {hasContent ? (
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
              <p className="text-sm opacity-75">
                Click "Record Audio" or "Record Screen" to start
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
            disabled={!hasContent}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>

          <div className="flex-1 h-1 bg-white/20 rounded-full">
            <div className="h-full w-0 bg-white rounded-full" />
          </div>

          <Button
            size="sm"
            variant="secondary"
            className="bg-black/50 hover:bg-black/70 text-white border-white/20"
            onClick={toggleMute}
            disabled={!hasContent}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </Button>

          <span className="text-white text-sm font-mono">
            {hasContent ? "Audio" : "Ready"}
          </span>
        </div>
      </Card>
    </div>
  )
}
