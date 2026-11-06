// VIEW-114: what the sidebar's onboarding slot shows. The newcomer checklist (ONB-013) while it is
// shown; otherwise, once onboarding has closed (or the profile predates it), the Setup Guide entry
// while a core step remains. Nothing shows until the reads have answered, so the slot never
// flashes a state it then takes back. Nothing here is sent anywhere: there is no telemetry.
import { GUIDE_CLOSED, ring, STEPS, words, type StepId } from "./guide";
import type { Checklist, FirstRun } from "./newcomer";

export type Slot = "checklist" | "guide" | null;

/** VIEW-114 (FIX-2): sent for every project the sidebar adds (useWizard's projectAdded), so the
 *  entry reads its steps again on an add instead of on every change of the project count. */
export const PROJECT_ADDED = "kolux-project-added";
export const projectAddedNote = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PROJECT_ADDED));
};

/** Window focus re-reads at most this often: each read asks gh, the CLI and every workspace. */
export const FOCUS_FLOOR_MS = 30_000;

/** VIEW-114 (FIX-4): when the entry last read its steps, kept apart from the event wiring so the reads
 *  that do not come from an event (useGuideState's read when the guide switches on) can stamp it too.
 *  It starts stamped: subscribing counts as a read, since the entry reads on mount. */
export type RereadFloor = { stamp: () => void; due: () => boolean };
export function rereadFloor(now: () => number = () => performance.now()): RereadFloor {
  let last = now();
  return { stamp: () => void (last = now()), due: () => now() - last >= FOCUS_FLOOR_MS };
}

/** VIEW-114 (FIX-2 FIX-SOON 2, FIX-3): the events that make the sidebar entry read its steps again:
 *  every Setup Guide close and every added project, and window focus only once FOCUS_FLOOR_MS has
 *  passed since the last read of any kind (so a step done in Settings or outside the app ticks when the
 *  user comes back). A read the guide made by itself, when it switched on, counts too once it stamps the
 *  floor passed in (FIX-4). Subscribing counts as a read, since the entry reads on mount, so the first focus
 *  after startup does not read twice. The clock is the monotonic one: a wall clock stepped back never
 *  holds focus re-reads off. Returns the cleanup. */
export function onReread(target: EventTarget, bump: () => void, now: () => number = () => performance.now(), floor: RereadFloor = rereadFloor(now)): () => void {
  const read = () => {
    floor.stamp();
    bump();
  };
  const focus = () => {
    if (!floor.due()) return;
    read();
  };
  target.addEventListener("focus", focus);
  target.addEventListener(GUIDE_CLOSED, read);
  target.addEventListener(PROJECT_ADDED, read);
  return () => {
    target.removeEventListener("focus", focus);
    target.removeEventListener(GUIDE_CLOSED, read);
    target.removeEventListener(PROJECT_ADDED, read);
  };
}

/** Whether the slot needs the guide's facts at all: the record is read, the checklist is not up and
 *  no wizard is still open. */
export const guideWanted = (c: Checklist, first: FirstRun | null | undefined): boolean => c.ready && !c.show && !(first && !first.closed);

/** The slot, from the checklist, the first-run record and the guide's last fully answered done set
 *  (null while its first read is still out). */
export function sidebarSlot(c: Checklist, first: FirstRun | null | undefined, settled: ReadonlySet<StepId> | null): Slot {
  if (!c.ready) return null;
  // ONB-013: the checklist leaves the sidebar the moment its last item is done; it does not wait
  // for a Hide click. Its short all-done line goes with it, because the sidebar is not a report.
  if (c.show) return c.done ? null : "checklist";
  if (!guideWanted(c, first) || settled === null) return null;
  const r = ring(settled);
  return r.done < r.total ? "guide" : null;
}

/** The entry's words: the count of core steps done and the next unfinished core step's name. */
export function entryLine(settled: ReadonlySet<StepId>): { done: number; total: number; count: string; next: string | null; nextId: StepId | null } {
  const r = ring(settled);
  const step = STEPS.find((s) => s.core && !settled.has(s.id)) ?? null;
  return { done: r.done, total: r.total, count: `${r.done} of ${r.total}`, next: step ? words(step).name : null, nextId: step?.id ?? null };
}
