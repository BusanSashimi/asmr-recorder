import { ASMRRecorder } from "./components/asmr-recorder";
import { ErrorBoundary } from "./components/error-boundary";

function App() {
  return (
    <main className="h-screen w-full overflow-hidden">
      <ErrorBoundary>
        <ASMRRecorder />
      </ErrorBoundary>
    </main>
  );
}

export default App;
