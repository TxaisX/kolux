// GIT-051: the rules for "Fix with AI" on a failed check: which checks count as failed, why the button is off,
// and the prompt sent to the workspace's agent. Pure, so the rules are tested without the window.
import { fixPrompt } from "./review";

export type PrCheck = { id: number; name: string; status: string; conclusion: string; url: string; runId: number | null };

const FAILING = ["failure", "timed_out", "cancelled", "action_required"];
/** The finished checks that did not pass. */
export function failedChecks(checks: PrCheck[]): PrCheck[] {
  return checks.filter((c) => c.status === "completed" && FAILING.includes(c.conclusion));
}

/** GIT-051: why "Fix with AI" is off for a check, or null when it can go: only a failed check with a
 * workflow run to read, and only with a workspace to send the prompt to. */
export function fixBlocker(c: PrCheck, workspace: string | null): string | null {
  if (!failedChecks([c]).length) return "Only a failed check can be fixed.";
  if (c.runId === null || !c.url.includes("/actions/runs/")) return "This check has no workflow run to read.";
  if (!workspace) return "Start a workspace for this pull request first, then its agent can fix the check.";
  return null;
}

/** The prompt sent to the workspace's agent: the same words as the Git panel's Fix with AI. */
export function fixText(c: PrCheck, log: string): string {
  return fixPrompt({ name: c.name, outcome: "failed", link: c.url }, log);
}
