// T-249-c (PROJ-089, the crash-report half): the crash screen's Report button. It opens the same Send
// Feedback message box as Help > Send Feedback (requestFeedback), already holding what broke above
// the version-and-system block, so the user only adds what they were doing. Nothing is sent by the
// app: the box hands a new-issue address to the browser as it always does.
// The crash screen (src/recovery/ScreenBoundary.tsx) replaces the whole App, which unmounts the box
// App.tsx mounts, so the screen mounts its own `CrashFeedback` beside the button
// (evidence/core-T-249-c-ScreenBoundary.tsx.patch).
import { requestFeedback } from "./feedback/request";
import { deferred } from "./lazy/deferred";
import { scrub } from "./feedback/scrub";

// Loaded when the crash screen draws, not at start: the box is only wanted once something has broken.
const FeedbackDialog = deferred(() => import("./feedback/FeedbackDialog"));

/** How many stack lines go into the report (the top of the stack names the broken part). */
export const STACK_LINES = 12;

/** The crash as written above the block: what broke, then the top of the stack when there is one. */
export function crashText(error: unknown, stackLines = STACK_LINES): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "") || "unknown error";
  const stack = error instanceof Error && error.stack ? error.stack.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("at ") || l.includes("@")) : [];
  const lines = ["The interface crashed (Kolux hit a problem).", "", `Error: ${message}`];
  if (stack.length) lines.push("", "Stack:", ...stack.slice(0, stackLines).map((l) => `  ${l}`));
  lines.push("", "What I was doing:", "");
  // Row 566: the message and the frames can name local paths (a dev build) or carry a secret, so the
  // text is scrubbed the way the feedback box scrubs what leaves, before the user ever sees it.
  return scrub(lines.join("\n"));
}

/** Opens the Send Feedback box with the crash text in it. */
export function reportCrash(error: unknown, request: (text: string, crash?: boolean) => void = requestFeedback): void {
  request(crashText(error), true);
}

/** The Report button on the crash screen. */
export function ReportButton({ error, request }: { error: unknown; request?: (text: string, crash?: boolean) => void }) {
  return (
    <button className="btn" onClick={() => reportCrash(error, request)}>
      Report
    </button>
  );
}

/** The Send Feedback box for the crash screen, where App's own is gone. */
export function CrashFeedback() {
  return <FeedbackDialog />;
}
