import { Component } from "react";
import { Button, Card } from "./ui";

// A single failing page must never take the whole dashboard down. The layout
// mounts one boundary per route (keyed by pathname), so navigating to another
// page clears the error without a full reload.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the detail in the console for support; the UI stays friendly.
    console.error("Page crashed:", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Card className="mt-6">
        <p className="text-sm font-medium text-(--foreground)">This page could not be displayed</p>
        <p className="mt-1 text-xs text-(--muted-foreground)">
          Something went wrong while rendering this screen. Your data is safe. Try again, or move to
          another page from the sidebar.
        </p>
        <p className="mt-3 break-words rounded-lg border border-(--border-subtle) bg-(--surface-secondary) px-3 py-2 text-[11px] text-(--muted-foreground)">
          {error?.message ?? String(error)}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button variant="subtle" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </div>
      </Card>
    );
  }
}

export default ErrorBoundary;
