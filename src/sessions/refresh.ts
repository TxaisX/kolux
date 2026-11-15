// VIEW-083 (T-169): the session list refreshes without stealing keystrokes. A scan can finish at any
// moment; its results are drawn only once typing in a terminal has been quiet for a moment, and
// never more than a second after they arrived. An agent start asks for a rescan, but only so often.

/** Typing counts as quiet after this long without a key. */
export const QUIET_MS = 300;
/** Results wait for quiet for at most this long. */
export const MAX_LATE_MS = 1000;
/** A started agent triggers at most one rescan per this interval. */
export const RESCAN_EVERY_MS = 5000;
/** The session file appears a moment after the agent starts, so the rescan waits this long. */
export const AFTER_START_MS = 1500;

/** How long to hold results that arrived at `arrivedAt` when the last key was at `lastKeyAt`. */
export function publishDelay(now: number, lastKeyAt: number, arrivedAt: number, quietMs = QUIET_MS, maxLateMs = MAX_LATE_MS): number {
  const quietAt = lastKeyAt + quietMs;
  const dueAt = Math.min(Math.max(quietAt, arrivedAt), arrivedAt + maxLateMs);
  return Math.max(0, dueAt - now);
}

/** Lets one start trigger a rescan only when the last one was long enough ago. */
export class RescanLimiter {
  private last = -Infinity;
  constructor(private every = RESCAN_EVERY_MS) {}
  allow(now: number): boolean {
    if (now - this.last < this.every) return false;
    this.last = now;
    return true;
  }
  /** Audit F18: how long a rescan asked for at `now` waits, at least `min`, so it runs once the interval is over. */
  wait(now: number, min: number): number {
    return Math.max(min, this.last + this.every - now);
  }
  /** Marks a rescan as run at `now`. */
  ran(now: number): void {
    this.last = now;
  }
}

/** The last results per scope, so reopening the tab shows them at once while a refresh runs. */
const last = new Map<string, unknown>();
export const remember = (key: string, value: unknown) => void last.set(key, value);
export const recall = <T>(key: string): T | undefined => last.get(key) as T | undefined;
