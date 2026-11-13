// USAGE-023 (T-070): when the usage figures are read again, and how a read that fails is ridden
// out. The decisions are pure functions of the clock and the last result (`shouldFetch`, `began`,
// `ended`), so they are tested with a fake clock; `runner` drives one provider's reads from them
// (a five-minute timer, the window focus, a manual refresh). Every provider has a runner of its
// own, so one failing or lagging never stalls or blanks the others.
import { useSyncExternalStore } from "react";
import type { ClaudeLimit } from "./claude";
import type { CodexUsage } from "./codex";

/** The background refresh period. */
export const EVERY_MS = 5 * 60_000;
/** "Moments ago": a focus this soon after a read does not read again. */
export const MOMENTS_MS = 30_000;
/** How long a focus waits after the 1st, 2nd, 3rd, 4th+ failure in a row; the cap is the timer period. */
export const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000];

export type Reason = "start" | "timer" | "focus" | "manual";
export type Sched = {
  /** When the last read began; null before any. */
  lastTry: number | null;
  /** When the last read that answered (figures or nothing new) ended. */
  lastOk: number | null;
  /** Failures in a row; 0 after any answer. */
  failures: number;
  /** The provider's own "try again after" moment, or null. */
  retryAfter: number | null;
  inFlight: boolean;
};

export const fresh = (): Sched => ({ lastTry: null, lastOk: null, failures: 0, retryAfter: null, inFlight: false });

export const backoffMs = (failures: number): number => BACKOFF_MS[Math.min(Math.max(failures, 1), BACKOFF_MS.length) - 1];

/** Whether a read should start now for this reason. */
export function shouldFetch(s: Sched, reason: Reason, now: number, moments: number = MOMENTS_MS): boolean {
  if (s.inFlight) return false;
  if (reason === "manual") return true; // ignores the debounce and the provider's retry-after alike
  if (s.retryAfter !== null && now < s.retryAfter) return false;
  if (reason === "start") return s.lastTry === null;
  if (reason === "timer") return true;
  if (s.lastTry === null) return true; // the first focus after a delayed start
  if (s.failures > 0) return now - s.lastTry >= backoffMs(s.failures);
  return now - s.lastTry >= moments;
}

export const began = (s: Sched, now: number): Sched => ({ ...s, inFlight: true, lastTry: now });

export function ended(s: Sched, ok: boolean, now: number, retryAfterMs: number | null = null): Sched {
  if (ok) return { ...s, inFlight: false, lastOk: now, failures: 0, retryAfter: null };
  return { ...s, inFlight: false, failures: s.failures + 1, retryAfter: retryAfterMs == null ? null : now + retryAfterMs };
}

/** What one read came back with. */
export type Fetched<T> = { kind: "ok"; value: T } | { kind: "nothing" } | { kind: "retry"; inMs: number } | { kind: "fail"; message: string; retryAfterMs?: number };

/** A busy provider is asked again this often, and at most this many times within one read. */
const RETRY_CAP = 20;

type Listener = { addEventListener(type: string, f: () => void): void; removeEventListener(type: string, f: () => void): void };
export type RunnerOptions<T> = {
  name: string;
  fetch: () => Promise<Fetched<T>>;
  onOk: (value: T) => void;
  onFail?: (message: string) => void;
  onChange?: (s: Sched) => void;
  now?: () => number;
  /** Where focus and visibility events come from; the window and document by default, none in tests. */
  focus?: Listener | null;
  visibility?: (Listener & { visibilityState?: string }) | null;
  /** FIX-2 (council P6): how soon after a read a focus may read again; MOMENTS_MS by default. */
  focusDebounceMs?: number;
};
export type Runner = { start(): void; stop(): void; kick(reason: Reason): boolean; state(): Sched };

const live = new Set<Runner>();
const subs = new Set<() => void>();
const states = new Map<string, Sched>();
const notify = () => subs.forEach((f) => f());

/** A dev-only hook for a live proof: a stub read per provider, a clock skew, and the call counts. */
type Dev = { skew: number; fetch: Record<string, (() => Promise<Fetched<unknown>>) | undefined>; calls: Record<string, number>; runners: Record<string, Runner> };
const dev: Dev | null = import.meta.env.DEV && typeof window !== "undefined" ? (((window as unknown as { __koluxUsageDev?: Dev }).__koluxUsageDev ??= { skew: 0, fetch: {}, calls: {}, runners: {} })) : null;

export function runner<T>(o: RunnerOptions<T>): Runner {
  let s = fresh();
  let timer: ReturnType<typeof setInterval> | undefined;
  let again: ReturnType<typeof setTimeout> | undefined;
  let gen = 0;
  const now = o.now ?? (() => Date.now() + (dev?.skew ?? 0));
  const focus = o.focus === undefined ? (typeof window !== "undefined" ? window : null) : o.focus;
  const visibility = o.visibility === undefined ? (typeof document !== "undefined" ? document : null) : o.visibility;
  const set = (next: Sched) => {
    s = next;
    states.set(o.name, s);
    o.onChange?.(s);
    notify();
  };
  const read = (): Promise<Fetched<T>> => {
    if (dev) dev.calls[o.name] = (dev.calls[o.name] ?? 0) + 1;
    const f = dev?.fetch[o.name] as (() => Promise<Fetched<T>>) | undefined;
    return (f ?? o.fetch)();
  };
  const run = (mine: number, tries: number) => {
    read()
      .catch((e): Fetched<T> => ({ kind: "fail", message: String(e) }))
      .then((r) => {
        if (mine !== gen) return; // stopped meanwhile
        if (r.kind === "retry" && tries < RETRY_CAP) {
          again = setTimeout(() => run(mine, tries + 1), r.inMs);
          return;
        }
        if (r.kind === "ok" || r.kind === "nothing") {
          set(ended(s, true, now()));
          if (r.kind === "ok") o.onOk(r.value);
        } else {
          set(ended(s, false, now(), r.kind === "fail" ? r.retryAfterMs : null));
          o.onFail?.(r.kind === "fail" ? r.message : "still busy");
        }
      });
  };
  const kick = (reason: Reason) => {
    if (!shouldFetch(s, reason, now(), o.focusDebounceMs)) return false;
    set(began(s, now()));
    run(gen, 0);
    return true;
  };
  const onFocus = () => void kick("focus");
  const onVisible = () => {
    if (!visibility?.visibilityState || visibility.visibilityState === "visible") kick("focus");
  };
  const me: Runner = {
    start() {
      gen += 1;
      live.add(me);
      if (dev) dev.runners[o.name] = me;
      states.set(o.name, s);
      // FIX-2 (council P6): no background reads while the window is hidden; showing it reads again.
      timer = setInterval(() => void (visibility?.visibilityState !== "hidden" && kick("timer")), EVERY_MS);
      focus?.addEventListener("focus", onFocus);
      visibility?.addEventListener("visibilitychange", onVisible);
      kick("start");
    },
    stop() {
      gen += 1;
      live.delete(me);
      clearInterval(timer);
      clearTimeout(again);
      focus?.removeEventListener("focus", onFocus);
      visibility?.removeEventListener("visibilitychange", onVisible);
      if (s.inFlight) set({ ...s, inFlight: false });
      // A stopped runner leaves nothing behind: a screen that still asks for this name reads the
      // empty state, not the last state of a provider nothing is reading any more.
      if (states.delete(o.name)) notify();
    },
    kick,
    state: () => s,
  };
  return me;
}

/** A manual refresh of every provider at once; how many reads it started. */
export function refreshAll(): number {
  let n = 0;
  for (const r of live) if (r.kick("manual")) n += 1;
  return n;
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
const NONE = fresh();
/** The scheduler state a screen reads for one provider name (the empty state when nothing is reading it). */
export function published(name: string): Sched {
  return states.get(name) ?? NONE;
}
/** The scheduler state of one provider, for the error mark: failing while the last read failed. */
export function useRefresh(name: string): Sched {
  return useSyncExternalStore(subscribe, () => published(name), () => NONE);
}

/** Claude: the last status-line report; an empty one is nothing new, so figures already shown stay. */
export const claudeFetched = (limits: ClaudeLimit[]): Fetched<ClaudeLimit[]> => (limits.length ? { kind: "ok", value: limits } : { kind: "nothing" });

/** Codex: busy (another read of the same home is running) is asked again in 3 s; error is a failure;
 *  signed-out, sign-in-again, api-key and ok are answers of their own. */
export const codexFetched = (u: CodexUsage): Fetched<CodexUsage> => (u.state === "busy" ? { kind: "retry", inMs: 3_000 } : u.state === "error" ? { kind: "fail", message: u.message ?? "Codex usage could not be read" } : { kind: "ok", value: u });
