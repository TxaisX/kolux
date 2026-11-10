// T-124-b (STAT-035 rest): the tab-name rule. A tab whose title said the agent needed action is
// renamed once the agent is done; for agents whose own titles do not show state (Codex for ready
// and action needed, Devin, Pi and OMP) Kolux writes its own title from hook status: the agent's
// name followed by "ready" or "action required", and a working spinner unless the agent's own
// working title already has one or holds session details. Every Kolux spinner advances on one
// shared beat; decorative frames are skipped while the window is hidden (final-state titles never
// go through the beat, so they always get through), and a pane whose terminal is gone leaves it.
// Pure apart from useBeatFrame, so every rule is tested in tabNameRule.test.ts; App.tsx calls it
// (evidence/hooks-T-124-b-App.tsx.patch).
import { useEffect, useState, useSyncExternalStore } from "react";
import type { AgentState } from "../projects/rows";

/** Agents whose own titles do not show every state, and which states Kolux names for them. */
export const OWN_TITLE_AGENTS: Record<string, { working: boolean }> = {
  codex: { working: false }, // Codex's own working title shows it is busy; ready and action needed do not
  devin: { working: true },
  pi: { working: true },
  omp: { working: true },
};

/** Kolux's spinner frames (braille, the same family STAT-033 reads as working). */
export const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
export const BEAT_MS = 120;

const NEEDS_YOU: ReadonlySet<AgentState> = new Set(["permission", "waiting", "blocked"]);
const FINISHED: ReadonlySet<AgentState> = new Set(["done", "idle", "interrupted"]);

/** A title that asks for the user: action required, permission, approval or input. */
export function saysActionNeeded(title: string): boolean {
  return /\b(action required|action needed|needs? (your )?(action|permission|approval|input|you)|waiting for (your )?(approval|permission|input)|permission (required|needed|request)|approve\??)\b/i.test(title);
}

/** A title that already carries a spinner of its own (braille or a quarter-circle busy mark). */
export const hasSpinner = (title: string): boolean => /[⠀-⣿]/.test(title) || /[◐◓◑◒]/.test(title);

/** The agent's own working title holds session details when it says more than the agent's name. */
export function holdsDetails(title: string | null | undefined, name: string): boolean {
  const t = (title ?? "").trim();
  if (!t) return false;
  const bare = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
  return bare !== "" && bare !== name.toLowerCase() && bare !== name.toLowerCase().replace(/\s+/g, "");
}

export type TitleInput = {
  /** What the tab would show without this rule (TERM-058's followed title). */
  shown: string;
  /** The user named the tab (or a worker's task label names it): the rule never touches it. */
  named: boolean;
  /** The catalogue id of the agent in the pane; null for a plain shell or other tab. */
  agent: string | null;
  /** The agent's display name ("Codex", "Pi"). */
  name: string;
  /** The title the running program set itself, if any. */
  live: string | null | undefined;
  /** The pane's last hook-fed state; undefined while no hook has reported. */
  state: AgentState | undefined;
  /** The shared beat's current spinner frame. */
  frame: string;
};

/** The title a tab shows once the rule is applied. */
export function statusTitle(o: TitleInput): string {
  if (o.named || !o.agent || o.state === undefined) return o.shown;
  const own = OWN_TITLE_AGENTS[o.agent];
  if (NEEDS_YOU.has(o.state)) return own ? `${o.name} action required` : o.shown;
  if (FINISHED.has(o.state)) {
    if (own) return `${o.name} ready`;
    // Any agent: a title still asking for action is stale once the agent is done.
    return saysActionNeeded(o.shown) ? `${o.name} ready` : o.shown;
  }
  if (o.state === "working" || o.state === "queued") {
    if (!own?.working) return o.shown;
    const live = (o.live ?? "").trim();
    if (live && (hasSpinner(live) || holdsDetails(live, o.name))) return o.shown;
    return `${o.frame} ${o.name}`;
  }
  return o.shown;
}

/** Whether a pane's title needs the beat at all (only Kolux's own working spinner animates). */
export function needsBeat(o: Omit<TitleInput, "frame" | "shown">): boolean {
  if (o.named || !o.agent || !(o.state === "working" || o.state === "queued")) return false;
  const own = OWN_TITLE_AGENTS[o.agent];
  if (!own?.working) return false;
  const live = (o.live ?? "").trim();
  return !(live && (hasSpinner(live) || holdsDetails(live, o.name)));
}

type Timers = { every: (fn: () => void, ms: number) => unknown; stop: (h: unknown) => void };
const realTimers: Timers = { every: (fn, ms) => setInterval(fn, ms), stop: (h) => clearInterval(h as ReturnType<typeof setInterval>) };

/** One shared beat for every Kolux spinner: panes join with their key and leave when their
 * terminal is gone; the timer runs only while someone listens; frames are not handed out while
 * `hidden()` says the window is hidden. */
export class Beat {
  private listeners = new Map<number, (frame: string) => void>();
  /** Readers of the frame (useBeatText); they do not keep the timer running, the joined panes do. */
  private watchers = new Set<() => void>();
  private handle: unknown = null;
  private i = 0;
  constructor(
    private hidden: () => boolean = () => typeof document !== "undefined" && document.hidden,
    private timers: Timers = realTimers,
    private ms = BEAT_MS,
  ) {}
  get frame(): string {
    return FRAMES[this.i % FRAMES.length];
  }
  get size(): number {
    return this.listeners.size;
  }
  get running(): boolean {
    return this.handle !== null;
  }
  join(key: number, fn: (frame: string) => void): () => void {
    this.listeners.set(key, fn);
    if (this.handle === null) this.handle = this.timers.every(() => this.tick(), this.ms);
    return () => this.leave(key);
  }
  leave(key: number): void {
    this.listeners.delete(key);
    if (this.listeners.size === 0 && this.handle !== null) {
      this.timers.stop(this.handle);
      this.handle = null;
    }
  }
  tick(): void {
    if (this.hidden()) return; // decorative frames skipped while the window is hidden
    this.i = (this.i + 1) % FRAMES.length;
    const f = this.frame;
    for (const fn of this.listeners.values()) fn(f);
    for (const fn of this.watchers) fn();
  }
  /** useSyncExternalStore's subscribe: told after every frame. */
  watch = (fn: () => void): (() => void) => {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  };
  /** useSyncExternalStore's snapshot. */
  snapshot = (): string => this.frame;
}

export const sharedBeat = new Beat();

/** Keeps the beat running for the panes in `keys` (the ones whose title animates) without
 * re-rendering the caller: the frame itself is read where it is drawn, with useBeatText. A pane
 * missing from `keys` (done, or its terminal gone) leaves. */
export function useBeatKeys(keys: number[], beat: Beat = sharedBeat): void {
  const sig = [...keys].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const offs = sig ? sig.split(",").map((k) => beat.join(Number(k), () => {})) : [];
    return () => offs.forEach((off) => off());
  }, [sig, beat]);
}

const still = () => () => {};

/** The beat's current frame for one tab label: only a label that animates (`on`) re-renders per frame. */
export function useBeatText(on: boolean, beat: Beat = sharedBeat): string {
  return useSyncExternalStore(on ? beat.watch : still, beat.snapshot);
}

/** The shared beat's frame for the panes in `keys` (the ones whose title animates); every caller
 * reads the same frame, and a pane missing from `keys` (done, or its terminal gone) leaves. */
export function useBeatFrame(keys: number[], beat: Beat = sharedBeat): string {
  const [frame, setFrame] = useState(beat.frame);
  const sig = [...keys].sort((a, b) => a - b).join(",");
  useEffect(() => {
    const offs = sig ? sig.split(",").map((k) => beat.join(Number(k), setFrame)) : [];
    return () => offs.forEach((off) => off());
  }, [sig, beat]);
  return frame;
}
