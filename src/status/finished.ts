// T-309-b (STAT-038): an agent finishing asks the pull request poll for one early round, so the
// workspace's pull request status moves shortly after the agent is done with no manual refresh.
// The status listener calls finished() on the "finished" note; the sidebar's poll listens through
// onFinish(). Pure apart from the listener list, so the rules are tested on their own.

/** A second finish report for one pane inside this window is the same finish. */
export const FINISH_DEBOUNCE_MS = 10_000;
/** How long after a finish the round runs: the agent's last push and the host's own view settle. */
export const REFRESH_AFTER_MS = 5_000;

type Listener = (cwd: string) => void;
const listeners = new Set<Listener>();
const lastFinish = new Map<number, number>();

/** The sidebar's poll subscribes; the returned function unsubscribes. */
export function onFinish(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/**
 * A pane finished a turn in `cwd`. Told to every listener once per finish, however many done updates
 * arrive for it. Returns whether it was told (false: no folder, or the same finish again).
 */
export function finished(paneKey: number, cwd: string | null, now = Date.now()): boolean {
  if (cwd === null) return false;
  const was = lastFinish.get(paneKey);
  if (was !== undefined && now - was < FINISH_DEBOUNCE_MS) return false;
  lastFinish.set(paneKey, now);
  for (const f of [...listeners]) f(cwd);
  return true;
}

/** For tests: forget every finish. */
export function resetFinished() {
  lastFinish.clear();
}

export const norm = (d: string) => d.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Whether the poll should run early for a finish in `cwd`: the window is shown, the folder is one
 * the sidebar lists (so a pull request view of it can be on screen) and no rate limit is running
 * (`limitedUntil` in seconds, 0 for none).
 */
export function wantsRefresh(a: { hidden: boolean; paths: string[]; cwd: string; limitedUntil: number; now: number }): boolean {
  if (a.hidden || a.limitedUntil * 1000 > a.now) return false;
  const c = norm(a.cwd);
  return a.paths.some((p) => norm(p) === c);
}
