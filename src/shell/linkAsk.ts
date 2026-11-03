// TERM-135: the first plain link click in terminal output asks where web links open. The rules are
// pure and tested here; LinkAskDialog.tsx draws the one dialog, TerminalPane hands each web click to
// `askLink`, and the Terminal page switch (linksOpenInKolux) counts as an answer too.
import { invoke } from "@tauri-apps/api/core";

export const KOLUX_FIELD = "linksOpenInKolux"; // true: web links in terminal output open in the Kolux browser
export const ASKED_FIELD = "linksDestinationAsked"; // true once the question was answered or the switch was set by hand

export type Dest = "kolux" | "system";
export type LinkState = { inKolux: boolean; asked: boolean };

export const readLinkState = (s: Record<string, unknown> | null | undefined): LinkState => ({ inKolux: s?.[KOLUX_FIELD] === true, asked: s?.[ASKED_FIELD] === true });

/** The settings written for an answer: the destination, and "asked" so the dialog never comes back. */
export const answerPatch = (dest: Dest): Record<string, boolean> => ({ [KOLUX_FIELD]: dest === "kolux", [ASKED_FIELD]: true });

/** The settings written when the switch on the Terminal & sessions page is turned by hand. */
export const switchPatch = (on: boolean): Record<string, boolean> => answerPatch(on ? "kolux" : "system");

/** Whether a click asks: only a click that names no destination, and only until it was answered.
 *  Shift (and Alt, which flips the saved destination) with the link modifier open at once. */
export const needsAsk = (state: LinkState, named: boolean): boolean => !state.asked && !named;

/** Escape or a click outside opens the waiting links in the system browser, once (nothing is saved). */
export const dismissed: Dest = "system";

/** The site the link points to, for the dialog (host only; a malformed address is shown as typed, cut short). */
export function siteOf(url: string): string {
  try {
    return new URL(url).host || url.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

export type Words = { title: string; lead: string; keep: string; other: string; tip: string };

/** The dialog's words. Already set to the Kolux browser: it offers keeping that or switching. */
export function dialogWords(state: LinkState, url: string, mac = false): Words {
  const mod = mac ? "Cmd" : "Ctrl";
  return {
    title: "Where should links open?",
    lead: `${siteOf(url)} is about to open. Open links from the terminal in the Kolux browser or in your system browser?`,
    keep: state.inKolux ? "Keep the Kolux browser" : "Kolux browser",
    other: state.inKolux ? "Use the system browser" : "System browser",
    tip: `Hold Shift with ${mod} and click to open the system browser for a single link. You can change this later in Settings, Terminal & sessions, under Links.`,
  };
}

// The one open question: every link clicked meanwhile waits and opens with the same answer.
type Waiting = { url: string; open: (to: Dest) => void };
let state: LinkState = { inKolux: false, asked: false };
let waiting: Waiting[] = [];
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

export type SavePatch = (set: Record<string, boolean>) => Promise<unknown>;
let save: SavePatch = (set) => invoke("settings_patch", { set, remove: [] });
export const setSaver = (f: SavePatch | null) => void (save = f ?? ((set) => invoke("settings_patch", { set, remove: [] })));

/** Fed from the settings reads (applyText): the saved destination and whether it was answered. */
export function applyLinkState(s: Record<string, unknown> | null | undefined): void {
  state = readLinkState(s);
  tell();
}

/** Hand a web click over. True: the click is taken (the dialog is up, or will be, and `open` runs
 *  with the answer); false: nothing to ask, the caller opens the link its usual way. */
export function askLink(url: string, named: boolean, open: (to: Dest) => void): boolean {
  if (!needsAsk(state, named)) return false; // while the dialog is up nothing is answered yet, so a plain click joins the one question
  waiting.push({ url, open });
  tell();
  return true;
}

/** The answer: saved once, then every waiting link opens with it. */
export function answerLinks(to: Dest): void {
  const w = waiting;
  waiting = [];
  state = { inKolux: to === "kolux", asked: true };
  void save(answerPatch(to)).catch(() => {});
  for (const x of w) x.open(to);
  tell();
}

/** Escape or a click outside: the waiting links open in the system browser this once, but nothing is saved and the
 *  question stays unanswered, so the next plain click asks again (UX lane A, shell.md row 9). */
export function dismissLinks(): void {
  const w = waiting;
  waiting = [];
  for (const x of w) x.open(dismissed);
  tell();
}

export const subscribeLinks = (f: () => void) => (subs.add(f), () => void subs.delete(f));
/** The first waiting link, or null while nothing is asked. */
export const waitingLink = (): string | null => waiting[0]?.url ?? null;
export const linkState = (): LinkState => state;
export const waitingCount = () => waiting.length;
