import { Component, type ReactNode } from "react";

/** Prevents a rendering bug from leaving the user with a blank screen. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto mt-24 max-w-md rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-800">
        <div className="mb-1 text-base font-semibold">Something went wrong displaying this page.</div>
        <p>Your data is safe. Reload the page to try again.</p>
        <button className="btn-secondary mt-4" onClick={() => (window.location.href = "/")}>Back to the dashboard</button>
      </div>
    );
  }
}
