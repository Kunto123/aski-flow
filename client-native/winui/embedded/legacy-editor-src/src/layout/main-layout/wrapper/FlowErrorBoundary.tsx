import { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_error: Error): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Suppress noisy third-party errors that don't affect the flow canvas.
    if (error.stack?.includes("videojs-wavesurfer")) return;
    console.error("Error Boundary caught an error", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="items-center pt-6 text-center">
          <h1>Something went wrong with this flow.</h1>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}
