import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Plus,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Trash2,
  GripVertical,
  ZoomIn,
  ZoomOut,
  Mic,
  Monitor,
} from "lucide-react"

interface Track {
  id: string
  name: string
  type: "audio" | "screen"
  muted: boolean
  clips: Array<{
    id: string
    name: string
    start: number
    duration: number
  }>
}

export function Timeline() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(1)
  const [playheadPosition, setPlayheadPosition] = useState(0)
  const [tracks, setTracks] = useState<Track[]>([
    {
      id: "audio-1",
      name: "Audio Track",
      type: "audio",
      muted: false,
      clips: [],
    },
    {
      id: "screen-1",
      name: "Screen Recording",
      type: "screen",
      muted: false,
      clips: [],
    },
  ])

  const minZoom = 0.25
  const maxZoom = 4
  const playbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const trackLabelsScrollRef = useRef<HTMLDivElement>(null)
  const timelineGridScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isPlaying) {
      playbackIntervalRef.current = setInterval(() => {
        setPlayheadPosition((prev) => prev + 1)
      }, 100)
    } else {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
        playbackIntervalRef.current = null
      }
    }

    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current)
      }
    }
  }, [isPlaying])

  useEffect(() => {
    const handleTimelinePlay = (event: CustomEvent) => {
      setIsPlaying(event.detail.isPlaying)
    }

    window.addEventListener("timelinePlayback", handleTimelinePlay as EventListener)
    return () => window.removeEventListener("timelinePlayback", handleTimelinePlay as EventListener)
  }, [])

  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.min(prev * 1.5, maxZoom))
  }

  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.max(prev / 1.5, minZoom))
  }

  const resetZoom = () => {
    setZoomLevel(1)
  }

  const getScaledWidth = (width: number) => width * zoomLevel
  const getScaledPosition = (position: number) => position * zoomLevel
  const timelineWidth = getScaledWidth(1200)
  const timeMarkerSpacing = getScaledWidth(60)

  const handleScroll = (source: "labels" | "grid", scrollTop: number) => {
    if (source === "labels" && timelineGridScrollRef.current) {
      timelineGridScrollRef.current.scrollTop = scrollTop
    } else if (source === "grid" && trackLabelsScrollRef.current) {
      trackLabelsScrollRef.current.scrollTop = scrollTop
    }
  }

  const handlePlay = () => {
    const newPlayingState = !isPlaying
    setIsPlaying(newPlayingState)
    window.dispatchEvent(
      new CustomEvent("timelinePlayback", {
        detail: { isPlaying: newPlayingState, playheadPosition },
      })
    )
  }

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    setPlayheadPosition(clickX / zoomLevel)
  }

  const addTrack = (type: "audio" | "screen") => {
    const newTrack: Track = {
      id: Date.now().toString(),
      name: `${type === "audio" ? "Audio" : "Screen"} ${tracks.filter((t) => t.type === type).length + 1}`,
      type,
      muted: false,
      clips: [],
    }
    setTracks([...tracks, newTrack])
  }

  const deleteTrack = (trackId: string) => {
    setTracks(tracks.filter((t) => t.id !== trackId))
  }

  const toggleTrackMute = (trackId: string) => {
    setTracks(tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)))
  }

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Timeline Header */}
      <div className="h-12 border-b border-border px-4 flex items-center gap-2">
        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2 bg-transparent"
          onClick={() => addTrack("audio")}
        >
          <Plus className="h-4 w-4" />
          <Mic className="h-4 w-4" />
        </Button>

        <Button 
          variant="outline" 
          size="sm" 
          className="gap-2 bg-transparent"
          onClick={() => addTrack("screen")}
        >
          <Plus className="h-4 w-4" />
          <Monitor className="h-4 w-4" />
        </Button>

        <Separator orientation="vertical" className="h-6" />

        <Button variant="outline" size="sm" onClick={handlePlay} className="bg-transparent">
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>

        <div className="text-sm font-medium">Timeline</div>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomOut}
            disabled={zoomLevel <= minZoom}
            className="bg-transparent"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <button
            onClick={resetZoom}
            className="text-sm text-muted-foreground w-12 text-center hover:text-foreground transition-colors cursor-pointer"
          >
            {Math.round(zoomLevel * 100)}%
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleZoomIn}
            disabled={zoomLevel >= maxZoom}
            className="bg-transparent"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="flex-1 flex min-h-0">
        {/* Track Labels */}
        <div className="w-40 border-r border-border bg-muted/30 flex flex-col">
          <div className="h-8 border-b border-border flex items-center px-3 flex-shrink-0">
            <span className="text-sm font-medium">Tracks</span>
          </div>

          <div className="flex-1 overflow-hidden">
            <ScrollArea
              className="h-full"
              onScrollCapture={(e) => {
                const target = e.target as HTMLDivElement
                handleScroll("labels", target.scrollTop)
              }}
            >
              <div ref={trackLabelsScrollRef}>
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className="h-12 border-b border-border flex items-center px-2 gap-2 group hover:bg-muted/20"
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity cursor-move" />

                    <div className={`w-3 h-3 rounded ${track.type === "audio" ? "bg-green-500" : "bg-blue-500"}`} />

                    <span className="text-sm flex-1 truncate">{track.name}</span>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-1 h-6 w-6"
                        onClick={() => toggleTrackMute(track.id)}
                      >
                        {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-1 h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => deleteTrack(track.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Timeline Grid */}
        <div className="flex-1 flex flex-col min-w-0">
          <div
            className="h-8 border-b border-border bg-muted/20 relative flex-shrink-0 overflow-x-auto cursor-pointer"
            onClick={handleTimelineClick}
          >
            {Array.from({ length: Math.ceil(20 * zoomLevel) }, (_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 border-l border-border/50"
                style={{ left: `${i * timeMarkerSpacing}px` }}
              >
                <span className="absolute top-1 left-1 text-xs text-muted-foreground">
                  {Math.floor(i / (2 * zoomLevel))}:{String(Math.round((i % (2 * zoomLevel)) * (30 / zoomLevel))).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>

          <div className="flex-1 overflow-hidden">
            <ScrollArea
              className="h-full"
              onScrollCapture={(e) => {
                const target = e.target as HTMLDivElement
                handleScroll("grid", target.scrollTop)
              }}
            >
              <div ref={timelineGridScrollRef} className="overflow-x-auto">
                <div className="relative" style={{ minWidth: `${timelineWidth}px` }}>
                  {tracks.map((track) => (
                    <div
                      key={track.id}
                      className="h-12 border-b border-border relative bg-background"
                    >
                      {track.clips.map((clip) => (
                        <div
                          key={clip.id}
                          className={`absolute top-1 bottom-1 rounded border flex items-center px-2 cursor-pointer transition-colors ${
                            track.type === "audio"
                              ? "bg-green-500/80 border-green-600 hover:bg-green-500/90"
                              : "bg-blue-500/80 border-blue-600 hover:bg-blue-500/90"
                          }`}
                          style={{
                            left: `${getScaledPosition(clip.start)}px`,
                            width: `${getScaledWidth(clip.duration)}px`,
                          }}
                        >
                          <span className="text-xs text-white font-medium truncate">{clip.name}</span>
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* Playhead */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
                    style={{ left: `${getScaledPosition(playheadPosition)}px` }}
                  >
                    <div className="absolute -top-1 -left-1 w-2 h-2 bg-red-500 rounded-full" />
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </div>
    </div>
  )
}
