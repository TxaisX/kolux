// ONB-001..005: the first-run wizard's pure rules; Wizard.tsx draws it, onboarding.rs keeps its record.
import { invoke } from "@tauri-apps/api/core";
import { isAiAgent } from "./agentKind";

export const SCREENS = [
  { id: "welcome", name: "Welcome", heading: "Several AIs can work on your files at the same time", sub: "Claude, Codex and Grok each take a part of the job, side by side." },
  { id: "connect", name: "Connect an AI", heading: "Connect an AI", sub: "Sign in with a plan you already pay for. No terminal needed." },
  { id: "work", name: "Your work", heading: "Your work", sub: "Pick the folder your AIs will work in." },
  { id: "session", name: "Start your agents", heading: "Start your agents", sub: "Next you pick the folders, how many agents, and which AI." },
] as const;

/** The record onboarding_get returns while the wizard is still open; `step` is the last screen finished, -1 for none. */
export type Record = { step: number };

/** ONB-001: the screen the wizard opens on, or null when it should not open. */
export const openAt = (rec: Record | null) => (rec ? Math.max(0, Math.min(rec.step + 1, SCREENS.length - 1)) : null);

type Chord = { key: string; ctrlKey: boolean; metaKey: boolean; isComposing: boolean; target: unknown };

/** ONB-001: Ctrl+Enter (Cmd+Enter on a Mac) fires the main button; never from a text field, mid-composition or while it is off. */
export function chordFires(e: Chord, disabled: boolean): boolean {
  if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.isComposing || disabled) return false;
  const t = e.target as { tagName?: string; type?: string; isContentEditable?: boolean } | null;
  if (!t) return true;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return false;
  return !(t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "range"].includes(t.type ?? "text"));
}

/** ONB-004: 'Pick a folder' hands over to the sidebar's Add Project dialog through this window event. */
export const ADD_PROJECT = "kolux-add-project";

/** ONB-006: Escape asks whether to leave, unless something inside already handled it or a composition is running. */
export const leaveKey = (e: { key: string; isComposing: boolean; defaultPrevented: boolean }) => e.key === "Escape" && !e.isComposing && !e.defaultPrevented;

type EscapeEvent = { key: string; isComposing: boolean; defaultPrevented: boolean; target: EventTarget | null; preventDefault(): void; stopPropagation(): void };

/**
 * ONB-006 (install trial): Escape must reach the wizard even when the key starts outside it. A focused
 * terminal behind the dialog swallows Escape before a bubble-phase window listener sees it, so this
 * listens in the capture phase. A key that starts inside the dialog is left to the dialog's own
 * bubble-phase listener, so its controls still come first; `held` (the leave question is up) leaves it
 * to that question. Returns the cleanup.
 */
export function escapeLeaves(
  win: { addEventListener(t: "keydown", f: (e: EscapeEvent) => void, capture: boolean): void; removeEventListener(t: "keydown", f: (e: EscapeEvent) => void, capture: boolean): void },
  inside: (t: EventTarget | null) => boolean,
  held: () => boolean,
  leave: () => void,
): () => void {
  const key = (e: EscapeEvent) => {
    if (held() || inside(e.target) || !leaveKey(e)) return;
    e.preventDefault();
    e.stopPropagation();
    leave();
  };
  win.addEventListener("keydown", key, true);
  return () => win.removeEventListener("keydown", key, true);
}

export type Outcome = "completed" | "dismissed";

/** ONB-009: the help menu's Onboarding item asks the window to start the wizard over through this event. */
export const REOPEN_WIZARD = "kolux-reopen-wizard";

/** ONB-009: true for a click that counts; one less than half a second after the click before it does not. */
export function oneClick(gap = 500) {
  let last = -Infinity;
  return (now = Date.now()) => {
    const counts = now - last >= gap;
    last = now;
    return counts;
  };
}

/** ONB-011: the first-success milestones onboarding.rs keeps, each once, on this machine only. */
export type Milestone = "aiConnected";

/** ONB-011: records a milestone (kept only the first time); the user sees nothing, even when the write fails. */
export const milestone = (name: Milestone, send: (cmd: string, args: { name: Milestone }) => Promise<unknown> = invoke): Promise<boolean> =>
  send("onboarding_milestone", { name }).then(
    () => (checklistChanged(), true),
    () => false,
  );

/** ONB-013: the newcomer checklist reads its record again when this event fires. */
export const CHECKLIST_CHANGED = "kolux-checklist-changed";
export const checklistChanged = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHECKLIST_CHANGED));
};

/** ONB-007: closing is latched while it is being stored; a failed store frees the latch and keeps
 * the close, so the next click on any of the wizard's ways out tries the same close once more. */
export function closer(store: (outcome: Outcome) => Promise<unknown>, done: () => void, fail: (err: unknown) => void) {
  let busy = false;
  let failed: { outcome: Outcome; after: () => void } | null = null;
  const end = (outcome: Outcome, after: () => void = () => {}) => {
    if (busy) return;
    busy = true;
    store(outcome).then(
      () => {
        busy = false;
        failed = null;
        done();
        after();
      },
      (err) => {
        busy = false;
        failed = { outcome, after };
        fail(err);
      },
    );
  };
  /** True when a failed close was tried again instead of the click's own action. */
  const retry = () => {
    if (!failed) return false;
    end(failed.outcome, failed.after);
    return true;
  };
  return { end, retry };
}

/** ONB-007 / VIEW-114 (FIX-2): the wizard's own closer. A stored close hides the wizard and then
 *  tells the sidebar's onboarding slot that the record changed, so the checklist or the Setup Guide
 *  entry shows at once instead of on the next window focus. */
export const wizardCloser = (store: (outcome: Outcome) => Promise<unknown>, hide: () => void, fail: (err: unknown) => void, changed: () => void = checklistChanged) =>
  closer(
    store,
    () => {
      hide();
      changed();
    },
    fail,
  );

/** ONB-009 / VIEW-114 (FIX-2): Help > Onboarding. A stored reopen shows screen one and tells the
 *  sidebar slot, which then hides its checklist or entry under the reopened wizard. */
export const reopenWizard = (reopen: () => Promise<unknown>, show: () => void, fail: (err: unknown) => void, changed: () => void = checklistChanged): Promise<void> =>
  reopen().then(
    () => {
      show();
      changed();
    },
    fail,
  );

/** ONB-010: the agent the first folder after onboarding starts: the saved default only; none on
 * automatic (no default) and none for a plain terminal, which the new workspace opens anyway
 * (FIX-5: the same agentKind rule the guide uses, so no spelling of "terminal" gets through). */
export const firstFolderAgent = <A extends { id: string; installed: boolean }>(offered: A[], defaultId: string): A | null =>
  !isAiAgent(defaultId) ? null : (offered.find((a) => a.installed && a.id === defaultId && isAiAgent(a.id)) ?? null);

/** ACCT-035: a failed connect attempt, worded so its toast names the agent it was for. */
export function connectFailed(agent: string, err: unknown): string {
  const why = String(err instanceof Error ? err.message : (err ?? ""))
    .replace(/^Error:\s*/, "")
    .trim();
  return why ? `${agent} could not connect: ${why}` : `${agent} could not connect. Try again in a moment.`;
}

/** ACCT-035: the friendly line shown when the connection statuses fail to load, in place of an empty
 *  page. The cards have no retry timer: they read again when the window gets focus back or on an
 *  agents event, so the line says only that (Check again shows only for some card states, FIX-2 R3). */
export const STATUSES_FAILED = "Kolux could not read your AI connections just now. Come back to this window to read them again.";

/** ACCT-035 (FIX-2 R3): each card passes this to its error setter on a good read, so the read-failure
 *  line goes away once a read works again while a connect failure the user has not seen out stays. */
export const clearReadFailure = (e: string | null): string | null => (e === STATUSES_FAILED ? null : e);

/** ACCT-035 (FIX-3): each card passes this to its error setter when a read fails, so the read-failure
 *  line fills an empty line or its own, but never replaces a connect failure the user has not seen out
 *  (a connect that fails is followed by a read, and that read may fail too). */
export const readFailed = (e: string | null): string => (e && e !== STATUSES_FAILED ? e : STATUSES_FAILED);

/** ACCT-035: the AI connections page reports each card's connected state here; the first time any
 * card says connected, the first-AI milestone is sent (onboarding.rs keeps only the first time,
 * across the wizard and this page). One landed write per window: later reports change nothing, while a
 * write that failed is tried again on the next connected report (FIX-3). A card reports only when its
 * connected state changes or the page is visited again (it mounts), so in the app that retry waits for
 * the next visit to AI connections, the next connection change or the next start (FIX-4). */
export function firstConnection(send: (name: Milestone) => Promise<boolean> = milestone) {
  let sent = false;
  return (on: boolean) => {
    if (!on || sent) return;
    // Held while the write is out so a burst of reports sends once; a write that did not land frees
    // it again, so the next connected report retries (FIX-3: it was spent before the write answered).
    sent = true;
    void send("aiConnected").then(
      (ok) => void (ok || (sent = false)),
      () => void (sent = false),
    );
  };
}

/** ACCT-035: the one reporter the settings page's Connect cards share (a stable function, so a
 * card's effect does not run again on every draw). */
export const firstAiConnected = firstConnection();
