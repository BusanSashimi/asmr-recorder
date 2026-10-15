import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

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
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 p-8">
        <div className="flex flex-col items-center gap-3 max-w-md w-full">
          <AlertTriangle className="h-8 w-8 text-warning" />
          <h1 className="text-title text-foreground">Something went wrong</h1>
          <pre className="w-full rounded-md bg-fill p-3 text-caption font-mono text-muted-foreground overflow-auto whitespace-pre-wrap">
            {error.message}
          </pre>
          <Button variant="accent" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
