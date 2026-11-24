// What chat panes tell each other (2026-11-24). Every pane has its own chat on one shared OpenCode server, but
// they share one history list, so two things cross panes: which pane holds which saved chat (so opening a
// chat another pane already holds goes to that pane, and two panes never type into one conversation), and
// the news that a saved chat was deleted (so a pane showing it starts a new chat instead of failing on its
// next send). A module, not React state: no pane re-draws for it unless it is the one concerned.

type Holder = { paneKey: number; focus: () => void };
const holders = new Map<string, Holder>();

/** This pane now shows the saved chat `id`; `focus` brings the pane forward. Another pane's claim on the same chat is replaced. */
export function claimSession(id: string, paneKey: number, focus: () => void): void {
  holders.set(id, { paneKey, focus });
}

/** This pane no longer shows `id` (it opened another, or closed). Only the pane that holds it can let it go. */
export function releaseSession(id: string, paneKey: number): void {
  if (holders.get(id)?.paneKey === paneKey) holders.delete(id);
}

/** The pane (other than `exceptKey`) that holds `id`, if any. */
export function holderOf(id: string, exceptKey: number): Holder | null {
  const h = holders.get(id);
  return h && h.paneKey !== exceptKey ? h : null;
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
