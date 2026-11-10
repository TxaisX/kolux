// TERM-123 / HID-028 (T-817): the window side of agent sleep. One check a minute while the switch is on
// (none at all while it is off); each due pane is first recorded on the Rust side (agent_pane_sleep: the
// session is saved the way workspace sleep saves it), then marked asleep (its terminal unmounts, which
// ends only that pane's process tree), then its terminal is ended once more by id for good measure. A
// failed record leaves the pane as it was. Wake takes the restored-tab path and no other: the agent's
// start line with its resume form (agent_start_line, as main.tsx asks at start), the pane's key marked
// restored so the terminal replays its kept output and a failed start keeps the tab with its reason.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Pane } from "../App";
import type { AgentState } from "../projects/rows";
import type { TurnInfo } from "../status/useAgentStatus";
import { draftOf } from "../chat/composer";
import { asleepNow, dueForSleep, sleepOn, timing, wokenFields, type PaneView, type StartLine } from "./agentSleep";

export type SleepDeps = {
  panes: Pane[];
  setPanes: Dispatch<SetStateAction<Pane[]>>;
  hook: Record<number, AgentState>;
  stamp: Record<number, { at: number; interrupted: boolean }>;
  turn: Record<number, TurnInfo>;
  running: Record<number, boolean>;
  setRunning: Dispatch<SetStateAction<Record<number, boolean>>>;
  focused: number;
  winFocused: boolean;
  inView: (key: number) => boolean;
  settings: Record<string, unknown> | null;
  restoredKeys: MutableRefObject<Set<number>>;
  ptys: MutableRefObject<Record<number, number>>;
};

/** The sleep check and Wake. `wakePane(key)` starts the sleeping pane's agent again on its resume line. */
export function useAgentSleep(deps: SleepDeps) {
  // The check reads the latest window state through a ref, so the interval is set once per switch/delay change.
  const latest = useRef(deps);
  latest.current = deps;
  const on = deps.settings !== null && sleepOn(deps.settings);
  const { idleMs, tickMs } = timing(deps.settings ?? {});
  useEffect(() => {
    if (!on) return; // the switch is off: no timer, nothing runs
    let busy = false;
    const check = async () => {
      if (busy) return;
      busy = true;
      try {
        const d = latest.current;
        const view = (key: number): PaneView => ({
          state: d.hook[key],
          changedAt: d.stamp[key]?.at,
          running: d.running[key],
          ask: d.turn[key]?.ask,
          monitoring: d.turn[key]?.monitoring,
          draft: draftOf(key),
          focusedInView: d.focused === key && d.winFocused && document.visibilityState === "visible" && d.inView(key),
        });
        for (const key of dueForSleep(d.panes, view, Date.now(), idleMs)) {
          const pane = latest.current.panes.find((p) => p.key === key);
          if (!pane || pane.asleep) continue;
          // Save first; any refusal (no session, a plain shell in front, the record not written) ends nothing.
          const id = await invoke<number>("agent_pane_sleep", { paneKey: key }).catch(() => null);
          if (id === null) continue;
          const asleep = asleepNow(Date.now(), latest.current.stamp[key]?.at);
          latest.current.setPanes((ps) => ps.map((p) => (p.key === key ? { ...p, asleep } : p)));
          delete latest.current.ptys.current[key];
          latest.current.setRunning((r) => {
            const { [key]: _gone, ...rest } = r;
            return rest;
          });
          await invoke("terminal_kill", { id }).catch(() => {}); // the unmount ends it too; a second end of a gone terminal is nothing
        }
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void check(), tickMs);
    return () => clearInterval(timer);
  }, [on, idleMs, tickMs]);

  const wakePane = async (key: number) => {
    const d = latest.current;
    const p = d.panes.find((x) => x.key === key);
    if (!p?.asleep) return;
    const line = await invoke<StartLine>("agent_start_line", { id: p.agentId, extra: [], prompt: "", restore: true, session: p.session ?? null }).catch(() => null);
    d.restoredKeys.current.add(key); // the terminal mounts as a restored tab: kept output replayed, a failed start keeps the tab with its reason
    d.setPanes((ps) => ps.map((x) => (x.key === key ? wokenFields(x, line) : x)));
  };
  return { wakePane };
}
