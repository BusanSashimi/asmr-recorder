import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { 
  Mic, 
  Monitor, 
  Download, 
  Play, 
  Pause, 
  Square, 
  SkipBack, 
  SkipForward,
  Circle
} from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "@/hooks/use-toast"

export function Toolbar() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isRecordingAudio, setIsRecordingAudio] = useState(false)
  const [isRecordingScreen, setIsRecordingScreen] = useState(false)

  const handleStartAudio = async () => {
    try {
      if (isRecordingAudio) {
        // Stop recording
        setIsRecordingAudio(false)
        toast({
          title: "Audio recording stopped",
          description: "Your audio has been saved",
        })
      } else {
        // Start recording
        await invoke("start_audio_capture")
        setIsRecordingAudio(true)
        toast({
          title: "Audio recording started",
          description: "Recording in progress...",
        })
      }
    } catch (error) {
      toast({
        title: "Audio capture failed",
        description: String(error),
        variant: "destructive",
      })
    }
  }

  const handleStartScreen = async () => {
    try {
      if (isRecordingScreen) {
        // Stop recording
        setIsRecordingScreen(false)
        toast({
          title: "Screen recording stopped",
          description: "Your recording has been saved",
        })
      } else {
        // Start recording
        await invoke("start_screen_capture")
        setIsRecordingScreen(true)
        toast({
          title: "Screen recording started",
          description: "Recording in progress...",
        })
      }
    } catch (error) {
      toast({
        title: "Screen capture failed",
        description: String(error),
        variant: "destructive",
      })
    }
  }

  const handlePlay = () => {
    setIsPlaying(!isPlaying)
    window.dispatchEvent(
      new CustomEvent("timelinePlayback", {
        detail: { isPlaying: !isPlaying },
      })
    )
  }

  const handleStop = () => {
    setIsPlaying(false)
    setIsRecordingAudio(false)
    setIsRecordingScreen(false)
    window.dispatchEvent(
      new CustomEvent("timelinePlayback", {
        detail: { isPlaying: false },
      })
    )
    toast({
      title: "Stopped",
      description: "All recording and playback stopped",
    })
  }

  const handleExport = () => {
    toast({
      title: "Export",
      description: "Export functionality coming soon...",
    })
  }

  const isRecording = isRecordingAudio || isRecordingScreen

  return (
    <div className="h-14 border-b border-border bg-card px-4 flex items-center gap-2">
      {/* Recording Controls */}
      <Button 
        variant={isRecordingAudio ? "destructive" : "outline"} 
        size="sm" 
        className="gap-2 bg-transparent" 
        onClick={handleStartAudio}
      >
        <Mic className={`h-4 w-4 ${isRecordingAudio ? "animate-pulse" : ""}`} />
        {isRecordingAudio ? "Stop Audio" : "Record Audio"}
      </Button>

      <Button 
        variant={isRecordingScreen ? "destructive" : "outline"} 
        size="sm" 
        className="gap-2 bg-transparent" 
        onClick={handleStartScreen}
      >
        <Monitor className={`h-4 w-4 ${isRecordingScreen ? "animate-pulse" : ""}`} />
        {isRecordingScreen ? "Stop Screen" : "Record Screen"}
      </Button>

      <Separator orientation="vertical" className="h-6" />

      {/* Playback Controls */}
      <Button variant="outline" size="sm" className="bg-transparent">
        <SkipBack className="h-4 w-4" />
      </Button>

      <Button variant="default" size="sm" onClick={handlePlay}>
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>

      <Button 
        variant="outline" 
        size="sm" 
        className="bg-transparent"
        onClick={handleStop}
        disabled={!isPlaying && !isRecording}
      >
        <Square className="h-4 w-4" />
      </Button>

      <Button variant="outline" size="sm" className="bg-transparent">
        <SkipForward className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-6" />

      {/* Export */}
      <Button variant="outline" size="sm" className="gap-2 bg-transparent" onClick={handleExport}>
        <Download className="h-4 w-4" />
        Export
      </Button>

      <div className="flex-1" />

      {/* Recording Indicator */}
      {isRecording && (
        <div className="flex items-center gap-2 text-destructive">
          <Circle className="h-3 w-3 fill-current animate-pulse" />
          <span className="text-sm font-medium">Recording</span>
        </div>
      )}

      {/* Timeline Position */}
      <div className="text-sm text-muted-foreground font-mono">00:00:00 / 00:00:00</div>
    </div>
  )
}
