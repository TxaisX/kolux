// Native terminal (NATIVE-TERMINAL.md, option c): with the `terminalNative` setting on, a pane's terminal
// is drawn by the Windows Terminal engine in a native child window that Rust places over the pane body
// (src-tauri/src/terminal/native_view.rs). Kolux's own session keeps running underneath; xterm still gets
// the output, so search, chat and restore keep working. This file keeps the native window on the pane's
// spot: it follows the pane body's size and position, hides it while the pane is hidden, and removes it
// when the pane goes. A native window always sits above the web page, so it steps aside (xterm shows
// through) while a menu, dialog or full-page screen overlaps the pane; `onShown` tells the pane whether
// the engine is drawing now, so xterm can give its GPU slot back meanwhile. The engine draws with Kolux's
// own look: the pane's terminal colours, font and cursor go with the attach and again whenever they change.
import { invoke } from "@tauri-apps/api/core";

/** What the engine's TerminalSetTheme takes (native_view.rs `Look`): COLORREFs (0x00BBGGRR), the font's
 *  first family, its size in points and the engine's cursor shape. */
export type NativeLook = { background: number; foreground: number; selection: number; cursorStyle: number; table: number[]; font: string; size: number };

type Rgba = [number, number, number, number];

function parseColour(css: string | undefined): Rgba | null {
  const c = (css ?? "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) {
      const v = [...h].map((d) => parseInt(d + d, 16));
      return [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    }
    if (h.length === 6 || h.length === 8) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(c);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [+m[1], +m[2], +m[3], Math.min(1, Math.max(0, a))];
}

/** A CSS colour as a Windows COLORREF; a see-through colour is laid over `under` first (the engine has
 *  no alpha). `fallback` for a colour it cannot read. */
export function colorref(css: string | undefined, fallback: number, under?: string): number {
  const c = parseColour(css);
  if (!c) return fallback;
  const base = c[3] < 1 ? (parseColour(under) ?? [0, 0, 0, 1]) : c;
  const ch = (i: number) => Math.round(Math.min(255, Math.max(0, c[i] * c[3] + base[i] * (1 - c[3]))));
  return (ch(2) << 16) | (ch(1) << 8) | ch(0);
}

/** The 16 palette slots in the engine's order. */
const TABLE = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
/** Windows Terminal's Campbell scheme: what a slot the theme leaves out draws as. */
const CAMPBELL = ["#0c0c0c", "#c50f1f", "#13a10e", "#c19c00", "#0037da", "#881798", "#3a96dd", "#cccccc", "#767676", "#e74856", "#16c60c", "#f9f1a5", "#3b78ff", "#b4009e", "#61d6d6", "#f2f2f2"];

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** The engine's look for a pane drawn with `theme`, the terminal `fontFamily` (a CSS stack) at `fontSize`
 *  CSS pixels and xterm's cursor shape. */
export function nativeLook(colours: object, fontFamily: string | undefined, fontSize: number | undefined, cursorStyle: string | undefined, blink: boolean | undefined): NativeLook {
  const theme = colours as Record<string, unknown>;
  const names = [...TABLE, ...TABLE.map((n) => "bright" + n[0].toUpperCase() + n.slice(1))];
  const background = colorref(str(theme.background), 0x0c0c0c);
  // The engine's cursor styles: 1 blinking block, 2 steady block, 3 and 4 underline, 5 and 6 bar (0 is its own default).
  const shape = cursorStyle === "bar" ? 5 : cursorStyle === "underline" ? 3 : 1;
  const font = (fontFamily ?? "").split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).find((f) => f && !/^(monospace|ui-monospace)$/i.test(f)) ?? "Cascadia Mono";
  return {
    background,
    foreground: colorref(str(theme.foreground), 0xcccccc),
    selection: colorref(str(theme.selectionBackground), 0x804020, str(theme.background)),
    cursorStyle: blink === false ? shape + 1 : shape,
    table: names.map((n, i) => colorref(str(theme[n]), colorref(CAMPBELL[i], 0))),
    font,
    size: Math.max(4, Math.round((fontSize ?? 13) * 0.75)),
  };
}

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
  /** Kolux's look for the engine now; sent with the attach and again after any of `lookEvents`. */
  look?: () => NativeLook;
  /** Window events that change the look (the theme and terminal text events). */
  lookEvents?: string[];
  /** The engine's grid after a fit: the session now runs at this size, so xterm keeps the same grid. */
  onGrid?: (cols: number, rows: number) => void;
};

/** Keeps a native view on `body` for the terminal `id()` names once it has one. Checks on every resize and
 *  every `everyMs` (a pane moved by the layout does not resize). Returns the stop function. */
export function bindNative(body: HTMLElement, id: () => number | null, hidden: () => boolean, call: Call = invoke, everyMs = 250, { covered = () => overlayOver(body), onShown, look, lookEvents = [], onGrid }: NativeOptions = {}): () => void {
  let attached: number | null = null;
  let restyle = false;
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
    if (attached === now && sameRect(want, shown) && !restyle) return;
    busy = true;
    try {
      let grid: unknown;
      if (attached === null) {
        if (want === null) return;
        restyle = false;
        grid = await call("native_term_attach", { id: now, rect: want, look: look?.() ?? null });
        attached = now;
      } else {
        const style = restyle;
        restyle = false;
        grid = await call("native_term_place", { id: now, rect: want, look: style ? (look?.() ?? null) : null });
      }
      if (Array.isArray(grid) && grid.length === 2 && grid[0] > 0 && grid[1] > 0) onGrid?.(grid[0], grid[1]);
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
  const relook = () => {
    restyle = true;
    void sync();
  };
  if (look) for (const ev of lookEvents) window.addEventListener(ev, relook);
  void sync();
  return () => {
    if (look) for (const ev of lookEvents) window.removeEventListener(ev, relook);
    watch?.disconnect();
    clearInterval(timer);
    if (attached !== null) void call("native_term_detach", { id: attached }).catch(() => {});
    mark(false);
    delete body.dataset.native;
  };
}
