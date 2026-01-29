import { Toolbar } from "./asmr-recorder/toolbar";
import { Preview } from "./asmr-recorder/preview";
import { Timeline } from "./asmr-recorder/timeline";
import { Toaster } from "@/components/ui/toaster";
import {
  RecordingProvider,
  useRecordingContext,
} from "@/contexts/recording-context";

function ASMRRecorderContent() {
  const { status } = useRecordingContext();

  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Top Toolbar */}
      <Toolbar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Preview - Takes up remaining space with 4-section grid */}
        <Preview isRecording={status.isRecording} />

        {/* Timeline at bottom */}
        <div className="h-64 border-t border-border">
          <Timeline />
        </div>
      </div>

      <Toaster />
    </div>
  );
}

export function ASMRRecorder() {
  return (
    <RecordingProvider>
      <ASMRRecorderContent />
    </RecordingProvider>
  );
}
