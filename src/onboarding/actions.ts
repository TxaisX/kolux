// ONB-016: the Setup Guide's action panels. The rules live here so they are tested without a
// browser: which project a new workspace goes to, the composer request and its retries, the
// notifications step (sound choices, the macOS permission card), and the default-agent step.
import { sameDir } from "../workspaces";
import { agentRows, disabledAgents, defaultAgentId, offeredAgents } from "../launch/agents";
import type { AgentInfo } from "../launch/PlusMenu";
import { SOUNDS, type Sound } from "../settings/notifications";
import type { Place } from "./guide";

// ---- Multi-task: the project a new workspace goes to ----

export type Proj = { id: string; name: string; path: string };
export type Target = { kind: "project"; project: Proj } | { kind: "ask" };

/** ONB-016: a new workspace goes to the project whose workspace is showing, failing that the first
 *  git project. A folder without git never qualifies (its workspace list could not be read: `null`);
 *  with no git project at all the step asks for one first. */
export function composeTarget(projects: readonly Proj[], lists: readonly (readonly Place[] | null)[], activePath: string | null): Target {
  const git = projects.flatMap((p, i) => (lists[i] ? [{ p, list: lists[i] as readonly Place[] }] : []));
  const active = activePath === null ? undefined : git.find((g) => g.list.some((w) => sameDir(w.path, activePath)));
  const pick = active ?? git[0];
  return pick ? { kind: "project", project: pick.p } : { kind: "ask" };
}

const quote = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
/** The project's folder row in the sidebar (the row carries the project's path as its title). Clicking it
 *  shows that folder, so the New session button after it starts the agent there. The per-project
 *  "New workspace" button is gone (Txais 2026-11-12: the sidebar never shows worktrees). */
export const folderRowFor = (p: Proj): string => `.proj[title="${quote(p.path)}"]`;
/** The sidebar's New session button (it opens the agent menu for the folder showing). */
export const NEW_SESSION = "button.sb-new";
/** What the step clicks, in order, to open the New session menu on a project. */
export const plusFor = (p: Proj): readonly string[] => [folderRowFor(p), NEW_SESSION];
/** The sidebar's Add project button. */
export const ADD_PROJECT = "button[title^='Add project']";

// ---- the composer request ----

/** What the request can do to the window: click the first shown control for a selector (false when
 *  none is drawn yet), say whether the sidebar's workspace list is the screen showing, and wait. */
export type Hands = { click: (selector: string) => boolean; onScreen: () => boolean; wait: (ms: number) => Promise<void> };
export const COMPOSER_TRIES = 12;
export const COMPOSER_WAIT_MS = 250;

/** ONB-016: asking for the composer. A request carries the epoch it was made in; `reset` (the guide
 *  closing or opening) voids every request made before it, so a request left over from before a
 *  close and reopen never opens anything. The retry clicks only while the screen it expects is up. */
export function composerRequests(hands: Hands) {
  let epoch = 0;
  return {
    reset: () => void (epoch += 1),
    async open(target: Target): Promise<"opened" | "asked" | "stale" | "gone"> {
      const mine = epoch;
      const selectors = target.kind === "ask" ? [ADD_PROJECT] : plusFor(target.project);
      for (let i = 0; i < COMPOSER_TRIES; i++) {
        if (mine !== epoch) return "stale";
        if (hands.onScreen() && selectors.every((s) => hands.click(s))) return target.kind === "ask" ? "asked" : "opened";
        await hands.wait(COMPOSER_WAIT_MS);
      }
      return mine !== epoch ? "stale" : "gone";
    },
  };
}

/** FIX-1: the Setup Guide's open state changed. Only opening voids the waiting composer requests (one left
 *  from before a close and reopen). Closing must not: the Create a workspace step closes the guide itself and
 *  then asks for the composer, and the close finishing would otherwise void that request's retries. */
export function guideOpenChanged(queue: { reset: () => void }, open: boolean): void {
  if (open) queue.reset();
}

// ---- Notifications ----

/** ONB-016: the sound choices, and whether a volume slider is drawn: non-system sounds get none.
 *  The old per-source notification switches are gone; Settings keeps the finer choices. */
export function soundPanel(sound: Sound): { choices: { id: Sound; label: string }[]; slider: boolean } {
  return { choices: SOUNDS, slider: sound === "system" };
}

export type Platform = "mac" | "windows" | "linux";
export const platformOf = (ua: string): Platform => (/mac/i.test(ua) ? "mac" : /win/i.test(ua) ? "windows" : "linux");

/** What the delivery check (notification_test) answered; `unsupported` where the system has no notifications. */
export type Delivery = { shown: boolean; blocked: boolean } | "unsupported";
export type CardState = "enabled" | "awaiting" | "dialog" | "blocked";

/** ONB-016: the macOS permission card. Hidden until the delivery check answers, and where
 *  notifications are not supported or the system is not macOS. Delivered reads as enabled, pending
 *  as awaiting, a first refusal as a dialog not yet answered and a later refusal (`asked`: the
 *  dialog was shown on an earlier check) as blocked. */
export function permissionCard(platform: Platform, delivery: Delivery | null, asked: boolean): { show: false } | { show: true; state: CardState } {
  if (platform !== "mac" || delivery === null || delivery === "unsupported") return { show: false };
  if (delivery.shown) return { show: true, state: "enabled" };
  if (!delivery.blocked) return { show: true, state: "awaiting" };
  return { show: true, state: asked ? "blocked" : "dialog" };
}

export const CARD_WORDS: Record<CardState, string> = {
  enabled: "Notifications are enabled for Kolux.",
  awaiting: "Waiting for the system to show the test notification.",
  dialog: "The system asked for permission; answer its dialog, then check again.",
  blocked: "Notifications are blocked for Kolux. Allow them in System Settings > Notifications.",
};

// ---- Default agent ----

/** ONB-016: the picker shows the lead agents (the default first, then Claude, Codex, Grok when
 *  installed); the other installed agents sit in a fold-out list. Agents switched off on the Agents
 *  page are not offered. */
export function agentPanel(agents: AgentInfo[], settings: Record<string, unknown> | null): { picker: AgentInfo[]; fallback: AgentInfo[]; current: string } {
  const current = defaultAgentId(settings);
  const rows = agentRows(offeredAgents(agents, settings), current);
  return { picker: rows.top, fallback: rows.more, current: disabledAgents(settings).includes(current) ? "" : current };
}

/** The fold-out toggle says show while folded and hide while open. */
export const foldLabel = (open: boolean): string => (open ? "Hide fallback agents" : "Show fallback agents");
