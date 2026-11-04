// T-225-b: the rest of the Source Control rules (VIEW-062..065, VIEW-070) as pure functions, so
// each one is proven by a unit test and the panel only asks. No back-end calls here.
import type { PrLook, Status, Step } from "./model";

// ---- VIEW-062: a long list is windowed -------------------------------------------------------

/** Rows to draw for a scrolled list: only the visible part plus a little either side. */
export function windowRange(total: number, scrollTop: number, viewport: number, rowHeight: number, overscan = 6): { start: number; end: number; padTop: number; padBottom: number } {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + Math.max(viewport, 0)) / rowHeight) + overscan);
  const start = Math.min(first, total);
  const end = Math.max(start, last);
  return { start, end, padTop: start * rowHeight, padBottom: (total - end) * rowHeight };
}

// ---- VIEW-062: never-older status ----------------------

/** Each lookup takes a ticket; an answer is applied only if no later ticket has been applied already. */
export function statusGuard() {
  let issued = 0;
  let applied = 0;
  return {
    begin: (): number => ++issued,
    accept(ticket: number): boolean {
      if (ticket <= applied) return false;
      applied = ticket;
      return true;
    },
  };
}

/** An automatic refresh that fails keeps the last good status on screen (with the reason); a
 * manual one, or one with nothing on screen, shows the failure. */
export function afterRefresh(prev: Status | null, got: Status | { error: string }, auto: boolean): { status: Status | null; error: string | null } {
  if (!("error" in got)) return { status: got, error: null };
  return { status: auto ? prev : null, error: got.error };
}

// ---- C10-R4-01: an action's failure outlives the reload that always follows it ------------------

/** The panel's two error slots, written in different places on purpose: `action` is what the last
 * stage, discard or abort threw, `read` is what a status read reported. One slot was cleared in the
 * same call that set it, because the reload runs in `finally` after every action. */
export type PanelErrors = { action: string | null; read: string | null };
export const noErrors: PanelErrors = { action: null, read: null };

/** A reload's own outcome, written beside an action's failure and never over it. */
export function afterReload(prev: PanelErrors, reloaded: Status | { error: string }): PanelErrors {
  return { ...prev, read: "error" in reloaded ? reloaded.error : null };
}

// ---- VIEW-064: the commit box ----------------------------------------------------------------

export type FailureSummary = { summary: string; lint: boolean; details: boolean };
const LINT = /\b(eslint|lint-staged|prettier|stylelint|biome|ruff|flake8|pylint|rubocop|clippy|golangci|tslint|lint)\b/i;
/** One line for a failed commit. A failure from the lint step of the commit hooks is named as one
 * (with its problem count when the tool printed it) instead of a wall of tool output; the details
 * toggle is offered only when the full text says more than the summary does. */
export function failureSummary(output: string): FailureSummary {
  const text = output.replace(/\u001b\[[0-9;]*m/g, "").trim();
  if (text === "") return { summary: "The commit failed and git gave no reason", lint: false, details: false };
  if (LINT.test(text)) {
    const n = /(\d+)\s+problems?\b/i.exec(text) ?? /\b(\d+)\s+(?:errors?|warnings?)\b/i.exec(text.replace(/\d+:\d+\s+error\b/gi, ""));
    const summary = n ? `The lint step of the commit hooks failed: ${n[1]} ${Number(n[1]) === 1 ? "problem" : "problems"}` : "The lint step of the commit hooks failed";
    return { summary, lint: true, details: true };
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  const first = (lines.find((l) => /^(error|fatal|hint|husky)\b/i.test(l)) ?? lines[0]).replace(/^(error|fatal):\s*/i, "");
  const summary = first.length > 140 ? `${first.slice(0, 137)}...` : first;
  return { summary, lint: false, details: lines.length > 1 || first.length > 140 };
}
/** While conflicts are unresolved or an operation is in progress the message box is disabled and the commit controls hidden. */
export function commitBox(s: Status | null): { boxDisabled: boolean; controlsHidden: boolean; why: string | null } {
  if (s === null) return { boxDisabled: false, controlsHidden: false, why: null };
  if (s.conflicts.length > 0) return { boxDisabled: true, controlsHidden: true, why: "Resolve the conflicts first" };
  if (s.operation) return { boxDisabled: true, controlsHidden: true, why: `A ${s.operation} is in progress` };
  return { boxDisabled: false, controlsHidden: false, why: null };
}

// ---- VIEW-064: generation defaults saved per repository or for all ----------------------------

export const GEN_DEFAULTS_KEY = "scmGenDefaults";
export type GenChoice = { agent: string; model: string | null; effort: string | null };
export type GenDefaults = { all: GenChoice | null; repos: Record<string, GenChoice> };
const isChoice = (v: unknown): v is GenChoice => typeof v === "object" && v !== null && typeof (v as GenChoice).agent === "string";
export function genDefaultsOf(v: unknown): GenDefaults {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const repos: Record<string, GenChoice> = {};
  if (typeof o.repos === "object" && o.repos !== null) for (const [k, c] of Object.entries(o.repos)) if (isChoice(c)) repos[k] = { agent: c.agent, model: c.model ?? null, effort: c.effort ?? null };
  return { all: isChoice(o.all) ? { agent: o.all.agent, model: o.all.model ?? null, effort: o.all.effort ?? null } : null, repos };
}
// ---- VIEW-065: the main git button ------------------------------------------------------------

/** The main button's step with the card's later rules: a branch that differs from its remote only
 * by equivalent patches is steered to Create PR (Force Push stays in the commit area); a detached
 * HEAD never offers Publish but offers Create PR when a compare base is known; Create PR waits
 * while a newer readiness check loads. */
export function mainStep(base: Step, s: Status | null, look: PrLook): { step: Step; forceInCommitArea: boolean } {
  if (s === null) return { step: base, forceInCommitArea: false };
  const clean = s.staged.length + s.changed.length + s.untracked.length + s.conflicts.length === 0;
  if (clean && s.branch === null) {
    if (s.base !== null) return { step: { label: "Create pull request", action: "pr", reason: look.loading ? "Checking for a pull request" : null }, forceInCommitArea: false };
    return { step: { label: "Create pull request", action: "pr", reason: "HEAD is detached and no compare base is known" }, forceInCommitArea: false };
  }
  if (clean && s.rewritten && s.upstream !== null && s.branch !== null) {
    const open = look.pr?.state === "OPEN";
    return { step: open ? { label: `Open pull request #${look.pr?.number}`, action: "pr", reason: null } : { label: "Create pull request", action: "pr", reason: look.loading ? "Checking for a pull request" : null }, forceInCommitArea: true };
  }
  return { step: base, forceInCommitArea: false };
}

// ---- VIEW-070: pull request from the sidebar --------------------------------------------------

export type StackPr = { number: number; head: string; base: string; state: string };

/** The setting that hides every Source Control AI action; the generate controls follow it. */
export const SCM_AI_HIDDEN_KEY = "scmAiHidden";
export const aiControlsShown = (settings: Record<string, unknown> | null): boolean => settings?.[SCM_AI_HIDDEN_KEY] !== true;
