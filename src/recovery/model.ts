// T-183 (APP-039, APP-042, APP-043): the pure side of crash reports and recovery. The components only
// wire this to the screen; nothing here talks to Tauri. The app never sends a report itself: the
// GitHub issue is pre-filled and opened in the user's browser.
import { FEEDBACK_REPO, URL_CAP } from "../settings/privacy";

/** A crash record from `crashes.json` (recovery.rs). */
export type Crash = { id: string; when: number; summary: string; dismissed: boolean };

/** How often the page tells the watch it is alive (APP-042; the watch waits 20 s). */
export const HEARTBEAT_MS = 2000;

/** The line shown when the previous run left no detail behind. */
export const NOTHING_CAPTURED = "Kolux ended without a clean exit; no error detail was captured.";

/** Whether a record carries any captured detail, or only the fact that the run ended badly. */
export function captured(c: Crash): boolean {
  return !c.summary.startsWith("Kolux ended without a clean exit");
}

/** `[Crash] ` plus the first line of the summary, 80 characters at most, so the issue is marked as a crash report. */
export function issueTitle(c: Crash): string {
  const line = (captured(c) ? c.summary : "Kolux closed without a clean exit").split(/\r?\n/)[0].trim();
  return Array.from(`[Crash] ${line}`).slice(0, 80).join("");
}

/** The new-issue address with the title and the details pre-filled; details are cut to fit a browser address. */
export function issueUrl(c: Crash, details: string, repo = FEEDBACK_REPO): string {
  const url = (body: string) => `${repo}?title=${encodeURIComponent(issueTitle(c))}&body=${encodeURIComponent(body)}`;
  const whole = url(details);
  if (whole.length <= URL_CAP) return whole;
  const note = "\n\n(trimmed to fit in a browser address)";
  let kept = Array.from(details);
  while (kept.length > 0 && url(`${kept.join("")}${note}`).length > URL_CAP) kept = kept.slice(0, Math.floor(kept.length * 0.8));
  return url(`${kept.join("")}${note}`);
}

/** The dialog: which record it shows and why. `pending` prompts once at startup; `help` is Help > Report Crash. */
export type Dialog = { crash: Crash; via: "pending" | "help" } | null;

/** The startup prompt shows the newest pending record once; nothing pending, nothing shown. */
export function openPending(pending: Crash | null): Dialog {
  return pending ? { crash: pending, via: "pending" } : null;
}

/** Help > Report Crash reopens the newest record, dismissed or not; with none ever recorded there is nothing to show. */
export function openFromHelp(latest: Crash | null): Dialog {
  return latest ? { crash: latest, via: "help" } : null;
}

/** The sentence under the title. */
export function dialogLead(d: NonNullable<Dialog>): string {
  if (d.via === "pending") return "Kolux did not close properly last time. You can report it; nothing is sent until you open the issue page and submit it yourself.";
  return captured(d.crash) ? "The most recent crash record. Nothing is sent until you open the issue page and submit it yourself." : NOTHING_CAPTURED;
}

/** APP-043: what the graphics prompt asks. `burst` is the in-session offer; `launch` is the recovered launch. */
export type GraphicsPrompt = { kind: "burst" } | { kind: "launch"; stay: boolean } | null;

/** Three context losses fired (recovery.rs decided): offer safe graphics, once. */
export function afterBurst(current: GraphicsPrompt, fired: boolean): GraphicsPrompt {
  if (!fired || current) return current;
  return { kind: "burst" };
}

/** The recovered launch asks whether to stay, stay preselected; a remembered choice asks nothing. */
export function launchPrompt(flag: { chosen: boolean } | null): GraphicsPrompt {
  if (!flag || flag.chosen) return null;
  return { kind: "launch", stay: true };
}

/** What the screen boundary says when a page section threw. */
export function boundaryMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err ?? "");
  return text ? `Part of the interface stopped working: ${text}` : "Part of the interface stopped working.";
}

/** T-199 (APP-028): what update_last_attempt hands the page once, at the launch after an install. */
export type LastAttempt =
  | { kind: "failed"; from: string; to: string; holder: string | null; releasesPage: string }
  | { kind: "updated"; version: string; notes: string[] }
  | null;

/** The notice for an install that did not take: still on the old version, with Try again and the installer page. */
export function updateNotice(a: LastAttempt): { text: string; releasesPage: string } | null {
  if (!a || a.kind !== "failed") return null;
  const why = a.holder ? ` ${a.holder} was holding Kolux's files.` : "";
  return {
    text: `The update to Kolux ${a.to} did not install, so this is still ${a.from}.${why} Try again, or download the installer and run it yourself.`,
    releasesPage: a.releasesPage,
  };
}
