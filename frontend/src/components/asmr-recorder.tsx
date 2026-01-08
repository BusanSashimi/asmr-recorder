import { Toolbar } from "./asmr-recorder/toolbar"
import { Preview } from "./asmr-recorder/preview"
import { Timeline } from "./asmr-recorder/timeline"
import { Toaster } from "@/components/ui/toaster"

export function ASMRRecorder() {
  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Top Toolbar */}
      <Toolbar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Preview - Takes up remaining space */}
        <Preview />

        {/* Timeline at bottom */}
        <div className="h-64 border-t border-border">
          <Timeline />
        </div>
      </div>

      <Toaster />
    </div>
  )
}
