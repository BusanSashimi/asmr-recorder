import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches uncaught render errors so a single component fault shows a contained
 * message instead of unmounting the whole tree (which renders as a blank window
 * in the Tauri WebView — there is no other error surface).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <pre className="max-w-full overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
          {error.message}
        </pre>
        <button
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
