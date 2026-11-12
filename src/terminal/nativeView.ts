// Native terminal (NATIVE-TERMINAL.md, option c): with the `terminalNative` setting on, a pane's terminal
// is drawn by the Windows Terminal engine in a native child window that Rust places over the pane body
// (src-tauri/src/terminal/native_view.rs). Kolux's own session keeps running underneath; xterm still gets
// the output, so search, chat and restore keep working. This file keeps the native window on the pane's
// spot: it follows the pane body's size and position, hides it while the pane is hidden, and removes it
// when the pane goes. A native window always sits above the web page, so it steps aside (xterm shows
// through) while a menu, dialog or full-page screen overlaps the pane; `onShown` tells the pane whether
// the engine is drawing now, so xterm can give its GPU slot back meanwhile.
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

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.width > 0 && a.height > 0 && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Web UI that floats over panes: the app's menus, dialogs and pickers. */
export const OVERLAYS = '[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"],.menu';

/** True when web UI is drawn over `body`: an open menu, dialog or picker overlapping it, or something else
 *  (a sheet, a full-page screen) on top of its middle. The native window would hide it, so it steps aside. */
export function overlayOver(body: HTMLElement, doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (!doc) return false;
  const b = body.getBoundingClientRect();
  for (const el of doc.querySelectorAll(OVERLAYS)) if (overlaps(el.getBoundingClientRect(), b)) return true;
  const top = doc.elementFromPoint?.(b.left + b.width / 2, b.top + b.height / 2);
  return !!top && !body.contains(top) && !top.contains(body);
}

export type NativeOptions = {
  /** Web UI over the pane right now (default overlayOver). */
  covered?: () => boolean;
  /** Called when the engine starts or stops drawing this pane (attached and on screen). */
  onShown?: (on: boolean) => void;
};

/** Keeps a native view on `body` for the terminal `id()` names once it has one. Checks on every resize and
 *  every `everyMs` (a pane moved by the layout does not resize). Returns the stop function. */
export function bindNative(body: HTMLElement, id: () => number | null, hidden: () => boolean, call: Call = invoke, everyMs = 250, { covered = () => overlayOver(body), onShown }: NativeOptions = {}): () => void {
  let attached: number | null = null;
  let shown: NativeRect | null = null;
  let failed = false;
  let busy = false;
  let drawing = false;
  const mark = (on: boolean) => {
    if (attached !== null) body.dataset.native = on ? "on" : "under";
    if (on === drawing) return;
    drawing = on;
    onShown?.(on);
  };
  const sync = async () => {
    if (busy || failed) return;
    const now = id();
    if (attached !== null && now !== attached) {
      await call("native_term_detach", { id: attached }).catch(() => {});
      attached = null;
      shown = null;
      mark(false);
    }
    if (now === null) return;
    const want = hidden() || covered() ? null : rectOf(body.getBoundingClientRect(), window.devicePixelRatio || 1);
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
      mark(want !== null);
    } catch (e) {
      failed = true; // no engine, or too many native panes: the pane stays on xterm
      mark(false);
      body.dataset.native = "off";
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
    mark(false);
    delete body.dataset.native;
  };
}
