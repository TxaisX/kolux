// APP-010: what the sidebar footer's help menu lists, in order, as plain data. HelpSheet draws it and
// wires the real actions in; this module holds no React and no Tauri, so the list, the three fixed
// web addresses and the restart's "once only" rule can be tested without a window.
import type { Page } from "../settings/pages";

/** The three fixed addresses that open in the system browser (DT-C80). Docs points at the repo's docs
 *  folder until a docs site exists. */
export const GITHUB_URL = "https://github.com/TxaisX/kolux-rs";
export const CHANGELOG_URL = "https://github.com/TxaisX/kolux-rs/releases";
export const DOCS_URL = "https://github.com/TxaisX/kolux-rs/tree/main/docs";

/** What Restart Kolux shows while the save point and relaunch run. */
export const RESTARTING = "Restarting…";

/** 49-ux2: the two setup entries and the tours say plainly which is which. */
export const HINTS = {
  "getting-started": "Checklist of setup steps",
  onboarding: "First-run setup wizard",
} as const;
export const TOURS_HINT = "Each tour runs once its screen is showing.";

export type HelpCtx = {
  /** Milestones stays only while a core step is unfinished (ONB-014). */
  milestones: { shown: boolean; done: number; total: number };
  restarting: boolean;
  openSettings: (page: Page) => void;
  openExternal: (url: string) => void;
  openGuide: () => void;
  openExplore: () => void;
  reopenWizard: () => void;
  requestFeedback: () => void;
  /** Opens the crash report dialog, the same one the chrome's Report Crash opens. */
  reportCrash: () => void;
  copyDiagnostics: () => void;
  checkForUpdates: () => void;
  restart: () => void;
};

export type HelpItem = {
  id: string;
  label: string;
  /** "top" sits above the Help group's title; "help" sits under it. */
  group: "top" | "help";
  run: () => void;
  /** The sheet stays open after the click (it has a status line to show, or the app is restarting). */
  keepOpen?: boolean;
  disabled?: boolean;
  /** Visible secondary text beside the label (not a hover title): what this entry opens. */
  hint?: string;
  /** Milestones only: the mini ring and its count. */
  ring?: { done: number; total: number };
};

/** The ordered list: Settings, then the Help group (APP-010's order, with the two getting-started
 *  entries ONB-014 added kept at its head). */
export function helpItems(c: HelpCtx): HelpItem[] {
  const help = (id: string, label: string, run: () => void, extra: Partial<HelpItem> = {}): HelpItem => ({ id, label, group: "help", run, ...extra });
  const items: HelpItem[] = [
    { id: "settings", label: "Settings", group: "top", run: () => c.openSettings("general") },
    help("getting-started", "Getting Started with Kolux", c.openGuide, { hint: HINTS["getting-started"] }),
    help("explore", "Explore Kolux", c.openExplore),
    help("docs", "Docs", () => c.openExternal(DOCS_URL)),
    help("changelog", "Changelog", () => c.openExternal(CHANGELOG_URL)),
    help("github", "GitHub", () => c.openExternal(GITHUB_URL)),
  ];
  if (c.milestones.shown) items.push(help("milestones", "Milestones", c.openGuide, { ring: { done: c.milestones.done, total: c.milestones.total } }));
  items.push(
    help("shortcuts", "Keyboard Shortcuts", () => c.openSettings("shortcuts")),
    help("onboarding", "Onboarding", c.reopenWizard, { hint: HINTS.onboarding }),
    help("feedback", "Send Feedback", c.requestFeedback),
    help("report-crash", "Report Crash", c.reportCrash),
    help("diagnostics", "Copy terminal diagnostics", c.copyDiagnostics, { keepOpen: true }),
    help("updates", "Check for Updates", c.checkForUpdates),
    help("restart", c.restarting ? RESTARTING : "Restart Kolux", c.restart, { keepOpen: true, disabled: c.restarting }),
  );
  return items;
}

export type RestartState = "idle" | "restarting";

/** Restart Kolux: the first click calls the back end and the state says "restarting"; further clicks
 *  while it runs do nothing. If the save point cancels the restart the state goes back to idle and the
 *  reason comes out through `failed`, so the user can try again. On success the app is gone. */
export function createRestart(call: () => Promise<unknown>, onState: (s: RestartState) => void, failed: (reason: string) => void): () => void {
  let busy = false;
  return () => {
    if (busy) return;
    busy = true;
    onState("restarting");
    call().catch((e: unknown) => {
      busy = false;
      onState("idle");
      failed(String(e));
    });
  };
}

export const DIAG_COPIED = "Copied to the clipboard with keys, passwords, tokens and home-folder paths masked.";

/** Copy terminal diagnostics: the back end's scrubbed summary onto the clipboard, then the line to show. */
export async function copyDiagnostics(summary: () => Promise<string>, clip: (text: string) => Promise<unknown>): Promise<string> {
  try {
    await clip(await summary());
    return DIAG_COPIED;
  } catch (e) {
    return `Copy terminal diagnostics failed: ${String(e)}`;
  }
}
