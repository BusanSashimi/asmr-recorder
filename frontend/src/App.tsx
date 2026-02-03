import { ASMRRecorder } from './components/asmr-recorder'
import { RegionSelectorOverlay } from './components/region-selector-overlay'

function App() {
  // Check URL params for window type
  const params = new URLSearchParams(window.location.search);
  const windowType = params.get('window');

  // Render region selector overlay for the overlay window
  if (windowType === 'region-selector') {
    return <RegionSelectorOverlay />;
  }

  // Default: render main application
  return (
    <main className="h-screen w-full overflow-hidden">
      <ASMRRecorder />
    </main>
  )
}

export default App
