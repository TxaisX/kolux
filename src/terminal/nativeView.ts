// Native terminal (NATIVE-TERMINAL.md, option c): with the `terminalNative` setting on, a pane's terminal
// is drawn by the Windows Terminal engine in a native child window that Rust places over the pane body
// (src-tauri/src/terminal/native_view.rs). Kolux's own session keeps running underneath; xterm still gets
// the output, so search, chat and restore keep working. This file keeps the native window on the pane's
// spot: it follows the pane body's size and position, hides it while the pane is hidden, and removes it
// when the pane goes. Experimental: web UI drawn over a pane (menus, dialogs) sits under the native window.
import { invoke } from "@tauri-apps/api/core";

export type NativeRect = { x: number; y: number; w: number; h: number };

/** The pane body's spot in physical pixels, or null when there is nothing to show (zero size). */
export function rectOf(box: { left: number; top: number; width: number; height: number }, dpr: number): NativeRect | null {
  const w = Math.round(box.width * dpr);
  const h = Math.round(box.height * dpr);
  if (w < 2 || h < 2) return null;
  return { x: Math.round(box.left * dpr), y: Math.round(box.top * dpr), w, h };
}

export const sameRect = (a: NativeRect | null, b: NativeRect | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

type Call = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Keeps a native view on `body` for the terminal `id()` names once it has one. Checks on every resize and
 *  every `everyMs` (a pane moved by the layout does not resize). Returns the stop function. */
export function bindNative(body: HTMLElement, id: () => number | null, hidden: () => boolean, call: Call = invoke, everyMs = 250): () => void {
  let attached: number | null = null;
  let shown: NativeRect | null = null;
  let failed = false;
  let busy = false;
  const sync = async () => {
    if (busy || failed) return;
    const now = id();
    if (attached !== null && now !== attached) {
      await call("native_term_detach", { id: attached }).catch(() => {});
      attached = null;
      shown = null;
    }
    if (now === null) return;
    const want = hidden() ? null : rectOf(body.getBoundingClientRect(), window.devicePixelRatio || 1);
    if (attached === now && sameRect(want, shown)) return;
    busy = true;
    try {
      if (attached === null) {
        if (want === null) return;
        await call("native_term_attach", { id: now, rect: want });
        attached = now;
      } else {
        await call("native_term_place", { id: now, rect: want });
      }
      shown = want;
    } catch (e) {
      failed = true; // no engine, or too many native panes: the pane stays on xterm
      console.warn("native terminal off for this pane:", e);
    } finally {
      busy = false;
    }
  };
  const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => void sync());
  watch?.observe(body);
  const timer = setInterval(() => void sync(), everyMs);
  void sync();
  return () => {
    watch?.disconnect();
    clearInterval(timer);
    if (attached !== null) void call("native_term_detach", { id: attached }).catch(() => {});
  };
}
