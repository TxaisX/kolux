// T-183 (APP-042): a thrown render error never leaves a blank window. The boundary shows what broke
// with Try again (remounts the tree) and Reload (reloads the page). A page showing this sends no
// heartbeat of its own (RecoveryMount went with the tree), so a boundary that stays up long enough
// is also caught by the watch in recovery.rs (one reload, one retry, then the native prompt).
// T-599 (F08-onboarding-look-misc.1): except while a report is written. That reload would wipe the
// Report box and the error above it, so from the first Report the screen sends the heartbeat itself
// until it is left. The box opens holding the crash text and keeps it when closed unsent (PROJ-089):
// it is open or has text from then until it is sent, and Try again and Reload stay on screen.
// ponytail: the box keeps open, typed and sent to itself, so the beat also outlives a sent report
// until the screen is left; upgrade path: FeedbackDialog tells its state and the beat stops on send.
import React from "react";
import { boundaryMessage } from "./model";
import { CrashFeedback, ReportButton } from "../crash";
import { requestFeedback } from "../feedback/request";
import { Heartbeat } from "./heartbeat";

type Props = { children: React.ReactNode };
type State = { error: unknown; tries: number; reporting: boolean };

export default class ScreenBoundary extends React.Component<Props, State> {
  state: State = { error: null, tries: 0, reporting: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }

  render() {
    if (this.state.error === null) return <React.Fragment key={this.state.tries}>{this.props.children}</React.Fragment>;
    return (
      <div role="alert" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12, maxWidth: 560, margin: "48px auto", color: "var(--fg-row)" }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Kolux hit a problem</h2>
        <p style={{ margin: 0 }}>{boundaryMessage(this.state.error)}</p>
        <p style={{ margin: 0, opacity: 0.8 }}>Your terminals keep running. Try again brings the interface back; Reload starts the page over.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => this.setState((s) => ({ error: null, tries: s.tries + 1, reporting: false }))}>
            Try again
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            Reload
          </button>
          {/* T-249-c (PROJ-089): Send Feedback with the crash text above the block */}
          <ReportButton error={this.state.error} request={(text, crash) => (this.setState({ reporting: true }), requestFeedback(text, crash))} />
        </div>
        <CrashFeedback />
        {this.state.reporting && <Heartbeat />}
      </div>
    );
  }
}
