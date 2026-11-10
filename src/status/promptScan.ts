// ORCH-056 / T-035-c (after-list row 219): the window asks Rust to read each pane's screen for an
// open agent prompt (permission, trust or question menus, Cursor approvals that send no hook).
// Rust's prompt_scan marks the pane waiting through the in-band status path, so the tab badge,
// Inbox and Board show it like any hook event; a pane whose hooks report a state is left to them.
// A pane restored from the saved layout tells Rust its old output ends at attach time, so a prompt
// only in restored scrollback never marks it waiting; a terminal that ended drops its scan memory.
import { invokeNamed, type CommandName } from "../ipc/commands";
import { onTerminalExit } from "../terminal/outputBus";
import { useEffect, type MutableRefObject } from "react";

export const SCAN_EVERY_MS = 1500;

export type Call = (cmd: CommandName, args: Record<string, unknown>) => Promise<unknown>;

/** The scan memory of one window: which terminal each pane was last scanned on. */
export function promptScanner(call: Call) {
  const seen = new Map<number, number>(); // pane key -> terminal id
  let busy = false;
  return {
    /** One pass over the panes with a live terminal; a pass still running skips this one. */
    async pass(ptys: Record<number, number>, restored: ReadonlySet<number>): Promise<boolean> {
      if (busy) return false;
      busy = true;
      try {
        for (const [k, terminal] of Object.entries(ptys)) {
          const paneKey = Number(k);
          if (!Number.isInteger(terminal)) continue;
          if (seen.get(paneKey) !== terminal) {
            seen.set(paneKey, terminal);
            if (restored.has(paneKey)) await call("prompt_scan_restored", { terminal }).catch(() => undefined);
          }
          await call("prompt_scan", { paneKey, terminal }).catch(() => undefined);
        }
        for (const k of [...seen.keys()]) if (!(k in ptys)) seen.delete(k);
      } finally {
        busy = false;
      }
      return true;
    },
    /** A terminal ended: its scan memory goes. */
    ended(terminal: number): Promise<unknown> {
      for (const [k, t] of seen) if (t === terminal) seen.delete(k);
      return call("prompt_scan_pruned", { terminal }).catch(() => undefined);
    },
  };
}

/** Mounted once by App: scans every pane's screen every SCAN_EVERY_MS. */
export function usePromptScan(ptys: MutableRefObject<Record<number, number>>, restored: MutableRefObject<Set<number>>): void {
  useEffect(() => {
    const scan = promptScanner((cmd, args) => invokeNamed(cmd, args));
    const timer = window.setInterval(() => void scan.pass(ptys.current, restored.current), SCAN_EVERY_MS);
    const off = onTerminalExit<{ id: number }>((e) => void scan.ended(e.payload.id));
    return () => {
      window.clearInterval(timer);
      off.then((f) => f()).catch(() => undefined);
    };
  }, [ptys, restored]);
}
