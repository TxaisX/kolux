// LAG-04A: two 20 s freezes on 2026-11-23 left nothing in the app log but a stopped heartbeat, so the
// cause is still unknown. This watches the engine's own long-task entries (a main-thread block of
// 50 ms or more, delivered after the block ends) and writes one short line per block of 500 ms or
// more through the existing boot_timing command: `<epoch> boot long:<ms>:<origin>:<vis>=<start>`.
// It fixes no freeze; it makes the next one visible. Never a reason to slow a start: no work per
// entry beyond one short string, no await, no retry, and the cap decides before anything is sent.
import { invoke } from "@tauri-apps/api/core";

/** A block counts from this many milliseconds. */
export const LONG_TASK_MS = 500;
/** Records allowed per window of time. */
export const LONG_TASK_BUDGET = 5;
/** Length of that window. */
export const LONG_TASK_WINDOW_MS = 60_000;

export type LongTaskEntry = { duration: number; startTime: number; name?: string };
export type LongTaskRecord = { name: string; ms: number };

/** Every character the log line may not hold, a colon included (the name is split on colons). */
const UNSAFE = /[^A-Za-z0-9_-]/g;

/** The text with unsafe characters removed, or `unknown` when nothing is left. */
function safe(part: string | undefined): string {
  if (typeof part !== "string") return "unknown";
  const kept = part.replace(UNSAFE, "");
  return kept === "" ? "unknown" : kept;
}

/** True when the duration is a finite number of at least LONG_TASK_MS. */
export function isLongTask(durationMs: number): boolean {
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= LONG_TASK_MS;
}

/** The log record for one entry, or null when the block was short. */
export function longTaskRecord(entry: LongTaskEntry, visibility: string): LongTaskRecord | null {
  if (!isLongTask(entry?.duration)) return null;
  const name = `long:${Math.round(entry.duration)}:${safe(entry.name)}:${safe(visibility)}`.slice(0, 48);
  const ms = Number.isFinite(entry.startTime) && entry.startTime >= 0 ? Math.round(entry.startTime) : 0;
  return { name, ms };
}

/** A fixed window: LONG_TASK_BUDGET records per LONG_TASK_WINDOW_MS, the rest counted as dropped. */
export function createLongTaskLimiter(now: () => number): { allow(): boolean; dropped(): number } {
  let windowStart = Number.NaN; // no window open yet (NaN compares false: the first call opens one)
  let used = 0;
  let dropped = 0;
  return {
    allow(): boolean {
      const t = now();
      if (!(t - windowStart < LONG_TASK_WINDOW_MS)) {
        windowStart = t;
        used = 0;
      }
      if (used < LONG_TASK_BUDGET) {
        used++;
        return true;
      }
      dropped++;
      return false;
    },
    dropped: () => dropped,
  };
}

type LongTaskObserverCtor = new (cb: (list: { getEntries(): LongTaskEntry[] }) => void) => {
  observe(options: { type: string; buffered?: boolean }): void;
};

export type LongTaskWatchDeps = {
  Observer?: LongTaskObserverCtor | null;
  send?: (r: LongTaskRecord) => void;
  now?: () => number;
  visibility?: () => string;
};

/** The page's own visibility, read defensively: a page without one (a test's stub) is `unknown`. */
function defaultVisibility(): string {
  try {
    const page = (globalThis as { document?: { visibilityState?: unknown } }).document;
    return typeof page?.visibilityState === "string" ? page.visibilityState : "unknown";
  } catch {
    return "unknown";
  }
}

/** Fire and forget through the log's existing command; an older backend that rejects changes nothing. */
function defaultSend(r: LongTaskRecord): void {
  void Promise.resolve(invoke("boot_timing", { name: r.name, ms: r.ms })).catch(() => {});
}

/** Starts the watch. Returns false (and does nothing else) when there is no observer or it refuses
 *  long tasks. Never throws. */
export function installLongTaskWatch(deps: LongTaskWatchDeps = {}): boolean {
  try {
    const Observer =
      deps.Observer === undefined
        ? (((globalThis as { PerformanceObserver?: unknown }).PerformanceObserver as LongTaskObserverCtor | undefined) ?? null)
        : deps.Observer;
    if (!Observer) return false;
    const now = deps.now ?? Date.now;
    const visibility = deps.visibility ?? defaultVisibility;
    const send = deps.send ?? defaultSend;
    const limiter = createLongTaskLimiter(now);
    const observer = new Observer((list) => {
      let entries: LongTaskEntry[] = [];
      try {
        entries = list.getEntries();
      } catch {
        return;
      }
      for (const entry of entries) {
        try {
          const r = longTaskRecord(entry, visibility());
          if (r === null) continue; // a short block never uses the budget
          if (!limiter.allow()) continue;
          try {
            send(r);
          } catch {
            /* a send that fails never breaks the watch */
          }
        } catch {
          /* one odd entry never stops the rest */
        }
      }
    });
    observer.observe({ type: "longtask", buffered: true });
    return true;
  } catch {
    return false;
  }
}
