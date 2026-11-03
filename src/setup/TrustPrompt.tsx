// SAFE-025 / STAT-056: before a repository's shared kolux.yaml script runs (the setup script on
// create, the issue command on a launch with an issue), Kolux shows exactly what would run and asks.
// Rust decides whether to ask (a fingerprint of the script's text, or the whole repository when
// always-trust was ticked) and refuses an untrusted script itself, so this side cannot be skipped:
// with no prompt mounted, nothing is approved and the script does not run. Prompts wait in line and
// show one at a time; Escape, a click outside, or another dialog opening over it counts as Don't
// run, and the next prompt still shows.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { SetupLine } from "../projects/model";

/** What Rust says the prompt must ask (SAFE-025): the script's kind, its exact text, the project's
 *  name, and whether an approved version of it has since changed. */
export type TrustAsk = { kind: "setup" | "archive" | "issue" | "tabs"; script: string; changed: boolean; project: string };
/** The user's answer: skip it, run it this once (this exact text), or trust the whole kolux.yaml. */
export type TrustAnswer = "skip" | "once" | "always";
type Invoke = <T>(cmd: string, args: Record<string, unknown>) => Promise<T>;
type Waiting = { id: number; ask: TrustAsk; done: (a: TrustAnswer) => void };

export const KIND_WORDS: Record<TrustAsk["kind"], string> = { setup: "setup script", archive: "archive script", issue: "issue command", tabs: "default tab commands" };

/** The prompt's title and lead line, worded for a changed script when one approved earlier changed. */
export function trustWords(ask: TrustAsk): { title: string; lead: string } {
  const what = KIND_WORDS[ask.kind] ?? "script";
  return ask.changed
    ? { title: `Run the changed ${what}?`, lead: `The ${what} in ${ask.project}'s kolux.yaml changed since you trusted it. This is the new version that would run:` }
    : { title: `Run ${ask.project}'s ${what}?`, lead: `${ask.project}'s committed kolux.yaml asks Kolux to run this ${what}. Run it only if you trust this repository:` };
}

// The line of waiting prompts, outside React so any caller can ask; one host draws the first.
let line: Waiting[] = [];
let hosts = 0;
let ids = 0;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());
/** For the prompt host (TrustDialog.tsx): follows the line; returns the stop. */
export const follow = (f: () => void) => (subs.add(f), () => void subs.delete(f));
/** The prompt on show, if any. */
export const shown = (): { id: number; ask: TrustAsk } | undefined => line[0];

/** SAFE-025: ask the user about `ask`; resolves when answered. With no prompt mounted it resolves
 *  "skip" at once, so nothing runs unasked. */
export function askTrust(ask: TrustAsk): Promise<TrustAnswer> {
  if (hosts === 0) return Promise.resolve("skip");
  return new Promise((done) => {
    line = [...line, { id: ++ids, ask, done }];
    changed();
  });
}

/** Answers the prompt on show and moves the line on to the next one. */
export function answerFirst(a: TrustAnswer): void {
  const [first, ...rest] = line;
  if (!first) return;
  line = rest;
  first.done(a);
  changed();
}

/** How many prompts wait, the one on show included (for tests and the host). */
export const waiting = () => line.length;

/** Mounts or unmounts a prompt host; the last one to go answers every waiting prompt "skip". */
export function hostMounted(on: boolean): void {
  hosts += on ? 1 : -1;
  if (hosts <= 0) {
    hosts = 0;
    while (line.length) answerFirst("skip");
  }
}

const DIALOG = '[role="dialog"],[role="alertdialog"],[aria-modal="true"]';
/** A dialog opened over the prompt: one among the newly `added` nodes (or inside one) that is not
 *  the prompt's own. A dialog already open underneath (the New Workspace dialog) does not count. */
export function otherDialog(added: Iterable<Node> | ArrayLike<Node>, mine: Element | null): boolean {
  for (const n of Array.from(added)) {
    const el = n as Element;
    if (typeof el.matches !== "function" || (mine && (mine === el || mine.contains(el)))) continue;
    if (el.matches(DIALOG) || el.querySelector(DIALOG)) return true;
  }
  return false;
}

/** SAFE-025: before the `kind` script runs for the worktree at `path`, asks when Rust says it must
 *  and records the answer; true when the script may run (nothing shared, already trusted, or the
 *  user chose Run hooks). `extra` carries workspace_setup's own arguments or the issue's `root`. */
export async function trusted(path: string, kind: TrustAsk["kind"], extra: Record<string, unknown> = {}, invoke: Invoke = tauriInvoke, ask: (a: TrustAsk) => Promise<TrustAnswer> = askTrust): Promise<boolean> {
  const need = await invoke<TrustAsk | null>("script_trust_needed", { path, kind, ...extra });
  if (!need) return true;
  const answer = await ask(need);
  if (answer === "skip") return false;
  await invoke<null>("script_trust_grant", { path, kind, script: need.script, always: answer === "always", root: extra.root ?? null });
  return true;
}

/** PROJ-033 + SAFE-025: the Setup terminal's line for the new worktree at `path`, asked for first
 *  when its script is the repository's shared one; null when there is none or the user said Don't run. */
export async function trustedSetup(path: string, opts: { local?: string | null; policy?: string | null } = {}, invoke: Invoke = tauriInvoke, ask: (a: TrustAsk) => Promise<TrustAnswer> = askTrust): Promise<SetupLine | null> {
  const args = { local: opts.local ?? null, policy: opts.policy ?? null };
  if (!(await trusted(path, "setup", args, invoke, ask))) return null;
  return invoke<SetupLine | null>("workspace_setup", { path, ...args });
}

