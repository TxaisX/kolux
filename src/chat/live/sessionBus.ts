// What chat panes tell each other (2026-11-24). Every pane has its own chat on one shared OpenCode server, but
// they share one history list, so two things cross panes: which pane holds which saved chat (so opening a
// chat another pane already holds goes to that pane, and two panes never type into one conversation), and
// the news that a saved chat was deleted (so a pane showing it starts a new chat instead of failing on its
// next send). A module, not React state: no pane re-draws for it unless it is the one concerned.

import { sameDir } from "../../workspaces";

type Holder = { paneKey: number; focus: () => void };
// Every pane that holds a chat, newest claim last: two panes can hold one chat for a moment (a restored layout, a
// pane still opening it), and closing one must not release the chat while the other still shows it.
const holders = new Map<string, Map<number, Holder>>();

/** The same folder, whatever the case, slash style or trailing slash (Windows paths). */
export const sameFolder = (a: string, b: string): boolean => sameDir(a, b);

/** This pane now shows the saved chat `id`; `focus` brings the pane forward. */
export function claimSession(id: string, paneKey: number, focus: () => void): void {
  const at = holders.get(id) ?? new Map<number, Holder>();
  at.delete(paneKey);
  at.set(paneKey, { paneKey, focus });
  holders.set(id, at);
}

/** This pane no longer shows `id` (it opened another, or closed). Only its own claim is dropped. */
export function releaseSession(id: string, paneKey: number): void {
  const at = holders.get(id);
  if (!at) return;
  at.delete(paneKey);
  if (at.size === 0) holders.delete(id);
}

/** The pane (other than `exceptKey`) that holds `id`, if any: the newest claim. */
export function holderOf(id: string, exceptKey: number): Holder | null {
  const at = holders.get(id);
  if (!at) return null;
  let found: Holder | null = null;
  for (const h of at.values()) if (h.paneKey !== exceptKey) found = h;
  return found;
}

export type Deleted = { cwd: string; id: string; /** The pane whose history column deleted it, or null. */ source: number | null };
const hearers = new Set<(d: Deleted) => void>();

/** A saved chat was deleted from OpenCode: every pane hears it. */
export function announceDeleted(d: Deleted): void {
  holders.delete(d.id);
  for (const fn of [...hearers]) fn(d);
}

export function onSessionDeleted(fn: (d: Deleted) => void): () => void {
  hearers.add(fn);
  return () => void hearers.delete(fn);
}

/** For tests. */
export function resetSessionBus(): void {
  holders.clear();
  hearers.clear();
}
