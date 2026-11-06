// SET-022 / SET-025: how terminal text, the cursor, history and the mouse behave. Read from the
// settings with every out-of-range or broken value corrected; panes follow TEXT_EVENT live.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ITerminalOptions } from "@xterm/xterm";
import { monoFont, SPAN } from "../theme";
import { fontStack } from "../settings/fonts";
import { applyInput } from "./inputWire";
import { drawOptions } from "../shell/termDraw";
import { applyLinkState } from "../shell/linkAsk";
import { LINK_MENU_FIELD, linkMenuOn } from "./linkMenu";

export const FIELDS = {
  size: "terminalFontSize",
  family: "terminalFont", // the same setting Appearance > Terminal font (TERM-097) writes
  weight: "terminalFontWeight",
  bold: "terminalFontWeightBold",
  lineHeight: "terminalLineHeight",
  cursor: "terminalCursorStyle",
  blink: "terminalCursorBlink",
  contrast: "terminalMinimumContrast",
  scrollback: "terminalScrollback",
  scroll: "terminalScrollSensitivity",
  fastScroll: "terminalFastScroll",
  copyOnSelect: "terminalCopyOnSelect",
  rightClickPaste: "terminalRightClickPaste",
  linkMenu: LINK_MENU_FIELD, // TERM-094: the link action menu, on unless switched off
} as const;

/** SET-026: the saved default shell (Windows); "auto" tries PowerShell 7, then Windows PowerShell. */
export const DEFAULT_SHELL_FIELD = "defaultShell";

/** One size rule for both cards (coordinator call 2026-10-19): the Appearance span, 8 to 32, default 13. */
export const SIZE = { min: SPAN.termSize[0], max: SPAN.termSize[1], start: SPAN.termSize[2] };
export const LINE_HEIGHT = { min: 1, max: 2, start: 1 };
export const SCROLLBACK = { min: 0, max: 100_000, start: 1000 };
export const WEIGHTS = ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"] as const;
export type Weight = (typeof WEIGHTS)[number];
export const CURSORS = ["block", "bar", "underline"] as const;
export type Cursor = (typeof CURSORS)[number];

export type TerminalText = {
  size: number;
  family: string;
  weight: Weight;
  bold: Weight;
  lineHeight: number;
  cursor: Cursor;
  blink: boolean;
  /** Minimum contrast on (opt-in, TERM-102): off by default because the per-cell contrast
   *  calculation is costly on a busy, long session. */
  contrast: boolean;
  scrollback: number;
  scroll: number;
  fastScroll: number;
  copyOnSelect: boolean;
  rightClickPaste: boolean;
  linkMenu: boolean;
};

const windows = () => typeof navigator !== "undefined" && /Windows/.test(navigator.userAgent);

/** A number from the settings inside [min, max], rounded to `step`; anything else is `start`. */
export function clampNumber(v: unknown, min: number, max: number, start: number, step = 1): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return start;
  const r = Math.round(n / step) * step;
  return Math.min(max, Math.max(min, Number(r.toFixed(2))));
}

const pick = <T extends string>(v: unknown, list: readonly T[], start: T): T => (list.includes(v as T) ? (v as T) : start);

export function readText(s: Record<string, unknown>, onWindows = windows()): TerminalText {
  return {
    size: clampNumber(s[FIELDS.size], SIZE.min, SIZE.max, SIZE.start),
    family: typeof s[FIELDS.family] === "string" ? (s[FIELDS.family] as string).trim() : "",
    weight: pick(String(s[FIELDS.weight] ?? ""), WEIGHTS, "normal"),
    bold: pick(String(s[FIELDS.bold] ?? ""), WEIGHTS, "bold"),
    lineHeight: clampNumber(s[FIELDS.lineHeight], LINE_HEIGHT.min, LINE_HEIGHT.max, LINE_HEIGHT.start, 0.05),
    cursor: pick(s[FIELDS.cursor], CURSORS, "block"),
    blink: s[FIELDS.blink] !== false,
    contrast: s[FIELDS.contrast] === true, // TERM-102: opt-in; the ratio is costly on long sessions
    // An older setting saved as a string of rows is read as rows.
    scrollback: clampNumber(s[FIELDS.scrollback], SCROLLBACK.min, SCROLLBACK.max, SCROLLBACK.start),
    scroll: clampNumber(s[FIELDS.scroll], 0.1, 5, 1.15, 0.1), // TERM-089: normal wheel speed 1.15
    fastScroll: clampNumber(s[FIELDS.fastScroll], 1, 20, 5),
    copyOnSelect: s[FIELDS.copyOnSelect] === true,
    rightClickPaste: typeof s[FIELDS.rightClickPaste] === "boolean" ? (s[FIELDS.rightClickPaste] as boolean) : onWindows, // on by default on Windows; right-click goes through attachPaste (council D2 MERGE 47 FB2)
    linkMenu: linkMenuOn(s), // TERM-094
  };
}

/** The family to draw with: the chosen one with the built-in stack behind it. */
export const familyOf = (t: TerminalText) => fontStack(t.family, monoFont);

/** The xterm options for `t`. */
export const optionsOf = (t: TerminalText): ITerminalOptions => ({
  fontSize: t.size,
  fontFamily: familyOf(t),
  fontWeight: t.weight,
  fontWeightBold: t.bold,
  lineHeight: t.lineHeight,
  cursorStyle: t.cursor,
  cursorBlink: t.blink,
  ...drawOptions(t.cursor), // TERM-101 hollow block only when unfocused, TERM-104 glyphs kept in their cells
  minimumContrastRatio: t.contrast ? 4.5 : 1,
  scrollback: t.scrollback,
  scrollSensitivity: t.scroll,
  fastScrollSensitivity: t.fastScroll,
});

let current = readText({});
/** The terminal text settings in force now; panes listen for TEXT_EVENT to follow changes. */
export const currentText = () => current;
export const TEXT_EVENT = "kolux-terminal-text";

export function applyText(s: Record<string, unknown> | null | undefined): void {
  current = readText(s ?? {});
  applyInput(s); // T-247-d: the input preferences ride the same settings reads
  applyLinkState(s); // TERM-135: where terminal links open, and whether that was asked
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TEXT_EVENT));
}

/** Call once at start: the saved values now, and again after every settings save. */
export function followText(saved: Record<string, unknown> | null | undefined): void {
  applyText(saved);
  void listen("settings-saved", () => {
    invoke<Record<string, unknown>>("get_settings").then(applyText, () => {});
  }).catch(() => {});
}
