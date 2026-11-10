// TERM-123 / HID-028 (T-817): the window side of agent sleep. One check a minute while the switch is on
// (nothing at all while it is off): every pane due for sleep is checked again against the latest state
// right before the Rust side is asked (the check awaits in between, so an earlier decision may be stale),
// the Rust side records the session and returns the terminal to end and the session id it recorded, the
// pane is marked asleep (its terminal unmounts, which ends that pane's Job object), and the terminal is
// ended by id once the unmount has committed, so no "[process ended]" lands in the dying view. A tick far
// past its interval (the machine slept) is skipped. Wake starts the recorded session on the restored-tab
// resume line; when the Rust side refuses, the pane stays asleep and a toast says why (nothing is spawned,
// so the launch line's prompt never runs again). After a wake the idle clock restarts.
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Pane } from "../App";
import type { AgentState } from "../projects/rows";
import type { TurnInfo } from "../status/useAgentStatus";
import { hasUnsent } from "../chat/composer";
import { asleepNow, idleMinutes, sleepOn, sleepRefusal, tickSkipped, timing, wokenFields, type PaneView, type Slept, type StartLine } from "./agentSleep";

export type Stamp = { at: number; interrupted: boolean };
export type SleepDeps = {
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  hook: Record<number, AgentState>;
  stamp: Record<number, Stamp>;
  setStamp: Dispatch<SetStateAction<Record<number, Stamp>>>;
  turn: Record<number, TurnInfo>;
  running: Record<number, boolean>;
  setRunning: Dispatch<SetStateAction<Record<number, boolean>>>;
  inView: (key: number) => boolean;
  settings: Record<string, unknown> | null;
  restoredKeys: MutableRefObject<Set<number>>;
  ptys: MutableRefObject<Record<number, number>>;
  setToast: (text: string) => void;
};

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/** What the check sees of pane `key` right now. */
export function viewOf(d: SleepDeps, key: number, visibleDoc: boolean): PaneView {
  return {
    state: d.hook[key],
    changedAt: d.stamp[key]?.at,
    running: d.running[key],
    ask: d.turn[key]?.ask,
    monitoring: d.turn[key]?.monitoring,
    draft: hasUnsent(key),
    visible: visibleDoc && d.inView(key),
  };
}

const visibleDoc = () => typeof document === "undefined" || document.visibilityState === "visible";
/** After the pane's re-render has committed and its terminal unmounted (well past React's commit of the state set). */
const afterCommit = () => new Promise<void>((r) => setTimeout(r, 50));

/** One check: puts every pane that may sleep to sleep. `latest` is read afresh at every step, so a pane that
 *  changed while an earlier pane was being handled is seen as it is now; the Rust side checks again too. */
export async function sleepCheck(latest: () => SleepDeps, idleMs: number, invoke: Invoke = tauriInvoke, now: () => number = Date.now, settle: () => Promise<void> = afterCommit): Promise<number[]> {
  const slept: number[] = [];
  const keys = latest().panes.map((p) => p.key);
  for (const key of keys) {
    const d = latest();
    const pane = d.panes.find((p) => p.key === key);
    if (!pane || sleepRefusal(pane, viewOf(d, key, visibleDoc()), now(), idleMs) !== null) continue;
    const before = d.ptys.current[key];
    const got = await invoke<Slept>("agent_pane_sleep", { paneKey: key, idleMinutes: idleMinutes(d.settings ?? {}) }).catch(() => null);
    if (got === null) continue;
    // Stale guard: while the Rust side was asked, the pane may have gone, restarted (another terminal id)
    // or changed state; only the very pane and terminal that were checked may be ended.
    const d2 = latest();
    const p2 = d2.panes.find((p) => p.key === key);
    if (!p2 || p2.asleep || d2.ptys.current[key] !== before || got.terminal !== before || sleepRefusal(p2, viewOf(d2, key, visibleDoc()), now(), idleMs) !== null) {
      // The Rust side moved the pane's live status row into the record; the pane stays, so the row comes back.
      await invoke("agent_pane_unsleep", { paneKey: key, session: got.session }).catch(() => {});
      continue;
    }
    const asleep = asleepNow(now(), d2.stamp[key]?.at, got.session);
    d2.setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, asleep } : p)));
    delete d2.ptys.current[key];
    d2.setRunning((r) => {
      const { [key]: _gone, ...rest } = r;
      return rest;
    });
    slept.push(key);
    // The unmounting TerminalPane kills its terminal itself (killsOnUnmount); this makes sure of it after the
    // commit, when no view listens to that terminal any more.
    await settle();
    await invoke("terminal_kill", { id: got.terminal }).catch(() => {});
  }
  return slept;
}

/** Wake pane `key`: the recorded session on the restored-tab resume line. A refusal keeps the pane asleep. */
export async function wakeOnce(d: SleepDeps, key: number, invoke: Invoke = tauriInvoke, now: () => number = Date.now): Promise<boolean> {
  const p = d.panes.find((x) => x.key === key);
  if (!p?.asleep) return false;
  let line: StartLine;
  try {
    line = await invoke<StartLine>("agent_start_line", { id: p.agentId, extra: [], prompt: "", restore: true, session: p.asleep.session });
  } catch (e) {
    d.setToast(`The sleeping agent did not wake: ${String(e)}`);
    return false;
  }
  d.restoredKeys.current.add(key);
  d.setPanes((ps) => ps.map((x) => (x.key === key ? wokenFields(x, line) : x)));
  // The idle clock restarts at the wake; the old "done" stamp would put the pane back to sleep within a minute.
  d.setStamp((s) => ({ ...s, [key]: { at: now(), interrupted: false } }));
  return true;
}

export function useAgentSleep(deps: SleepDeps) {
  const latest = useRef(deps);
  latest.current = deps;
  const on = deps.settings !== null && sleepOn(deps.settings);
  const { idleMs, tickMs } = timing(deps.settings ?? {});
  useEffect(() => {
    if (!on) return;
    let busy = false;
    let lastTick = Date.now();
    const tick = () => {
      const now = Date.now();
      const gap = now - lastTick;
      lastTick = now;
      if (busy || tickSkipped(gap, tickMs)) return;
      busy = true;
      void sleepCheck(() => latest.current, idleMs).finally(() => {
        busy = false;
      });
    };
    const timer = setInterval(tick, tickMs);
    return () => clearInterval(timer);
  }, [on, idleMs, tickMs]);
  // One wake per pane at a time: a click on the placeholder fires mousedown, focus and click together.
  const waking = useRef(new Set<number>());
  const wakePane = async (key: number) => {
    if (waking.current.has(key)) return;
    waking.current.add(key);
    try {
      await wakeOnce(latest.current, key);
    } finally {
      waking.current.delete(key);
    }
  };
  return { wakePane };
}
