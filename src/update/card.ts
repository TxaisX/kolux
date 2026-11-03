// APP-025 / APP-026 / APP-027: what the update card and the ready pop-up show. A pure reducer
// (card.test.ts); UpdateCenter.tsx wires it to the timetable and the back end.

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string[];
  date?: string | null;
}

export type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; received: number; total: number | null }
  | { kind: "ready"; info: UpdateInfo }
  | { kind: "error"; message: string; next: string; info: UpdateInfo | null; retry: "check" | "download" | "none" | "compat" | "restart"; security?: boolean; calm?: boolean };

export interface CardState {
  phase: Phase;
  /** The card is on screen (expanded or collapsed). */
  shown: boolean;
  collapsed: boolean;
  /** T-600: the user asked for what the card shows and still holds it: their Check for updates, the
   *  status-bar item or the card's expand. Only then does a bare Enter run Restart. Collapse, dismiss,
   *  fading and a quiet check clear it; a quiet check and a download error never set it. */
  requested: boolean;
  /** The current flow started with the user's own check: its changes of phase reopen the card, also
   *  after a collapse (APP-026). A quiet check starts a flow of its own, which never does. */
  flow: boolean;
  /** Release notes of the offered version; cleared when a new check begins. */
  notes: string[];
  dismissed: string | null;
  /** The reassurance tip is gone for good (persisted). */
  tipDone: boolean;
  /** The tip shows during this flow (decided when the update was first offered). */
  tipNow: boolean;
  popup: string | null;
  /** Versions whose pop-up was already shown this launch. */
  popupSeen: string[];
}

export type Action =
  | { type: "checkStart"; requested: boolean }
  | { type: "checkDone"; requested: boolean; found: UpdateInfo | null }
  | { type: "checkFailed"; requested: boolean; message: string; offline: boolean; next?: string }
  | { type: "downloadStart"; info: UpdateInfo }
  | { type: "progress"; version: string; received: number; total: number | null }
  | { type: "ready"; info: UpdateInfo }
  | { type: "downloadFailed"; info: UpdateInfo; message: string; offline: boolean }
  | { type: "notReady" }
  | { type: "restartFailed"; message: string }
  | { type: "faded" }
  | { type: "collapse" }
  | { type: "expand" }
  | { type: "dismiss" }
  | { type: "show" }
  | { type: "tipDismiss" }
  | { type: "popupClose" }
  | { type: "hydrate"; dismissed: string | null; tipDone: boolean };

export function initialCard(dismissed: string | null, tipDone: boolean): CardState {
  return { phase: { kind: "idle" }, shown: false, collapsed: false, requested: false, flow: false, notes: [], dismissed, tipDone, tipNow: false, popup: null, popupSeen: [] };
}

export function nextStep(offline: boolean, stage: "check" | "download"): string {
  if (offline) return "You look offline. Connect to the internet, then press Try again.";
  return stage === "check"
    ? "Press Try again in a minute. If it keeps failing, get the newest version from the releases page."
    : "Press Try again to download it once more; your work is not affected.";
}

/** T-293 (APP-030): the marker update_download puts before a refused installer's reason. */
export const REFUSED_MARK = "update:refused|";
/** T-199 (APP-031): markers update_check / update_download put before their words. */
export const QUIET_MARK = "update:quiet|";
export const COMPAT_MARK = "update:compat|";
export const STALE_MARK = "update:stale";
/** A half-published release or a missing platform entry is looked at again this soon. */
export const SHORT_RECHECK_MS = 10 * 60 * 1000;
export const isQuiet = (m: string) => m.startsWith(QUIET_MARK) || m === STALE_MARK;

/** The card for a calm "not yet" or a compatibility-mode offer, or null for any other error. */
export function problemPhase(raw: string, info: UpdateInfo | null): Phase | null {
  if (raw.startsWith(QUIET_MARK)) {
    const message = raw.slice(QUIET_MARK.length) || "There is no complete update to install yet.";
    return { kind: "error", message, next: "Nothing is wrong with your copy; it keeps working. No need to press anything.", info, retry: "none", calm: true };
  }
  if (raw.startsWith(COMPAT_MARK)) {
    const message = "The connection to the update server broke off in a way that compatibility mode usually gets past.";
    return { kind: "error", message, next: "Use compatibility mode to check again over an older, sturdier kind of connection.", info, retry: "compat" };
  }
  return null;
}

/** The updater's own words, turned into a sentence a user can act on. */
export function plainError(raw: string): string {
  if (/signature/i.test(raw)) return "The download's signature did not match, so it was thrown away.";
  if (/sending request|connect|dns|resolve|network|timed out|timeout|no answer/i.test(raw)) return "Kolux RS could not reach the update server.";
  if (/status code|404|not found/i.test(raw)) return "The update server did not have the release.";
  return raw;
}

export function versionOf(p: Phase): string | null {
  return "info" in p && p.info ? p.info.version : null;
}

// A change of phase reopens the card when it belongs to the user's own check, unless the user
// dismissed this very version.
function reopen(s: CardState, phase: Phase): CardState {
  const v = versionOf(phase);
  const show = s.flow && !(v !== null && v === s.dismissed);
  return { ...s, phase, shown: s.shown || show, collapsed: show ? false : s.collapsed };
}

/** The user's own check, or a quiet one they took over: the card comes up, expanded, in their hands. */
const theirs = { requested: true, flow: true, shown: true, collapsed: false };

export function cardReducer(s: CardState, a: Action): CardState {
  switch (a.type) {
    case "checkStart": {
      // T-600: a quiet check is a flow of its own and leaves the card as it is (APP-026).
      if (!a.requested) return { ...s, requested: false, flow: false };
      // A request while a quiet check runs takes that check over; the notes reset.
      return { ...s, ...theirs, notes: [], tipNow: false, phase: { kind: "checking" } };
    }
    case "checkDone": {
      // T-600: only a check the user asked for (the schedule says which) shows or reopens the card.
      const asked = a.requested;
      if (!a.found) return asked ? { ...s, ...theirs, phase: { kind: "upToDate" } } : s;
      const info = a.found;
      // A ready download of the same version stays ready.
      if (s.phase.kind === "ready" && s.phase.info.version === info.version) {
        return asked ? { ...s, ...theirs, notes: info.notes } : s;
      }
      const tipNow = s.tipNow || !s.tipDone;
      const next: CardState = { ...s, notes: info.notes, tipNow, phase: { kind: "available", info } };
      return asked ? { ...next, ...theirs } : next;
    }
    case "checkFailed": {
      // APP-024: a background check never shows an error.
      if (!a.requested) return s;
      // T-199 (APP-031): a half-published feed is explained calmly; a protocol error offers compatibility mode.
      const special = problemPhase(a.message, null);
      if (special) return { ...s, ...theirs, phase: special };
      return {
        ...s,
        ...theirs,
        phase: { kind: "error", message: a.next ? a.message : plainError(a.message), next: a.next ?? nextStep(a.offline, "check"), info: null, retry: "check" },
      };
    }
    case "downloadStart": {
      // Once a download starts the tip never comes back on later updates.
      return reopen({ ...s, tipDone: true, notes: s.notes.length ? s.notes : a.info.notes }, { kind: "downloading", info: a.info, received: 0, total: null });
    }
    case "progress": {
      if (s.phase.kind !== "downloading" || s.phase.info.version !== a.version) return s;
      return { ...s, phase: { ...s.phase, received: a.received, total: a.total } };
    }
    case "ready": {
      const v = a.info.version;
      const next = reopen({ ...s, notes: s.notes.length ? s.notes : a.info.notes }, { kind: "ready", info: a.info });
      // The pop-up shows once per version per launch, and stays silent while the card shows this update.
      const cardOnIt = next.shown && versionOf(next.phase) === v;
      if (cardOnIt || s.popupSeen.includes(v)) return next;
      return { ...next, popup: v, popupSeen: [...s.popupSeen, v] };
    }
    case "downloadFailed": {
      // T-293 (APP-030): a refused installer is a security stop: no Try again, no install anyway.
      if (a.message.startsWith(REFUSED_MARK)) {
        const message = a.message.slice(REFUSED_MARK.length);
        const next = "There is no way to install this download. If you did not expect this, get Kolux RS from its releases page.";
        return { ...s, shown: true, collapsed: false, popup: null, phase: { kind: "error", message, next, info: a.info, retry: "none", security: true } };
      }
      // T-199 (APP-031): an installer not uploaded yet says nothing after a quiet check.
      const special = problemPhase(a.message, a.info);
      if (special?.kind === "error" && special.calm && !s.flow) return { ...s, phase: { kind: "idle" } };
      // Download errors bring the card up even after a quiet check; T-600: they never put it in the user's hands.
      if (special) return { ...s, shown: true, collapsed: false, phase: special };
      return {
        ...s,
        shown: true,
        collapsed: false,
        phase: { kind: "error", message: plainError(a.message), next: nextStep(a.offline, "download"), info: a.info, retry: "download" },
      };
    }
    case "notReady":
      return { ...s, popup: null, phase: s.phase.kind === "ready" ? { kind: "idle" } : s.phase };
    case "restartFailed": {
      // T-199 (APP-029): the installer could not start; the app stays open with the real reason and
      // the downloaded update stays ready for another try.
      const info = s.phase.kind === "ready" || (s.phase.kind === "error" && s.phase.retry === "restart") ? s.phase.info : null;
      if (!info) return { ...s, popup: null, phase: s.phase.kind === "ready" ? { kind: "idle" } : s.phase };
      const next = "Kolux RS stayed open; your terminals were ended for the install and can be reopened. Fix the cause, then press Restart to update again.";
      return { ...s, popup: null, requested: true, shown: true, collapsed: false, phase: { kind: "error", message: a.message, next, info, retry: "restart" } };
    }
    case "faded":
      return s.phase.kind === "upToDate" ? { ...s, shown: false, requested: false, flow: false, phase: { kind: "idle" } } : s;
    case "collapse":
      // T-600: set aside, the card is no longer in the user's hands.
      return s.shown ? { ...s, collapsed: true, requested: false } : s;
    case "expand":
      return { ...s, collapsed: false, requested: true };
    case "dismiss": {
      const v = versionOf(s.phase);
      const keepFlow = s.phase.kind === "ready" || s.phase.kind === "downloading";
      return {
        ...s,
        shown: false,
        collapsed: false,
        requested: false,
        flow: false,
        dismissed: v ?? s.dismissed,
        phase: keepFlow ? s.phase : s.phase.kind === "available" ? s.phase : { kind: "idle" },
      };
    }
    case "show":
      // VIEW-100: the status bar item brings the card back, expanded, while there is an update to show.
      return s.phase.kind === "idle" ? s : { ...s, shown: true, collapsed: false, requested: true };
    case "tipDismiss":
      return { ...s, tipDone: true, tipNow: false };
    case "popupClose":
      return { ...s, popup: null };
    case "hydrate":
      return { ...s, dismissed: a.dismissed, tipDone: a.tipDone };
  }
}

/** The tip shows while an update is offered or downloading, the first time only. */
export function tipVisible(s: CardState): boolean {
  return s.tipNow && s.shown && !s.collapsed && (s.phase.kind === "available" || s.phase.kind === "downloading");
}

/** The card's main action, run by Enter. */
export function mainAction(p: Phase): "close" | "download" | "restart" | "retryCheck" | "retryDownload" | "compat" | null {
  switch (p.kind) {
    case "upToDate":
      return "close";
    case "available":
      return "download";
    case "ready":
      return "restart";
    case "error":
      if (p.security) return "close";
      return ({ none: null, check: "retryCheck", download: "retryDownload", compat: "compat", restart: "restart" } as const)[p.retry];
    default:
      return null;
  }
}

/** The words on the card's main button. A security stop closes with "Close" (council FIX-2 AFTER 5):
 *  "OK" there could read as agreeing to the stopped update. */
export function actionLabel(p: Phase): string | null {
  const action = mainAction(p);
  if (action === "restart") return "Restart to update";
  if (action === "download") return "Download";
  if (action === "retryCheck" || action === "retryDownload") return "Try again";
  if (action === "compat") return "Use compatibility mode";
  if (action === "close") return p.kind === "error" ? "Close" : "OK";
  return null;
}

export interface BarItem {
  tone: "info" | "ready" | "error";
  text: string;
  title: string;
}

/** VIEW-100: the status bar's update item; nothing while idle, checking or up to date. */
export function barItem(p: Phase): BarItem | null {
  const title = "Click to show the update card";
  switch (p.kind) {
    case "available":
      return { tone: "info", text: `Update ${p.info.version}`, title: `Kolux RS ${p.info.version} is available. ${title}` };
    case "downloading": {
      const pct = p.total ? ` · ${Math.min(100, Math.floor((p.received / p.total) * 100))}%` : "";
      return { tone: "info", text: `Downloading ${p.info.version}${pct}`, title: `Downloading Kolux RS ${p.info.version}. ${title}` };
    }
    case "ready":
      return { tone: "ready", text: "Restart to update", title: `Kolux RS ${p.info.version} is ready to install. ${title}` };
    case "error":
      if (p.calm) return null;
      return { tone: "error", text: p.security ? "Update refused" : "Update failed", title: `${p.message} ${title}` };
    default:
      return null;
  }
}

/** The tip above the card. Restarting really does close every terminal and agent, so it says so. */
export const RESTART_TIP = "Restarting to update closes your open terminals and agents. Kolux RS asks before it restarts.";

/** What the restart confirmation says: nothing restarts until the user agrees. */
export const RESTART_ASK = { title: "Restart to update?", body: "Restarting closes every open terminal and agent. Anything still running in them ends. Save what you need first.", confirm: "Restart now" } as const;

/** The action button's words while the restart is under way. */
export const restartingLabel = (label: string | null, restarting: boolean): string | null => (restarting ? "Restarting…" : label);

/** Escape on the ready pop-up (nothing inside it holds the keyboard) is Later, unless a field or another handler took the key. */
export function popupEscapes(e: { key: string; defaultPrevented: boolean; target: object | null }): boolean {
  if (e.key !== "Escape" || e.defaultPrevented) return false;
  const t = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = t?.tagName?.toLowerCase();
  return !(tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable);
}
