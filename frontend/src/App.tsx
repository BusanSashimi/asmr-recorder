import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ASMRRecorder } from "./components/asmr-recorder";
import { ErrorBoundary } from "./components/error-boundary";

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={500}>
        <main className="h-screen w-full overflow-hidden">
          <ErrorBoundary>
            <ASMRRecorder />
          </ErrorBoundary>
        </main>
      </TooltipProvider>
    </MotionConfig>
  );
}

export default App;
