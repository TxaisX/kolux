// SET-022 / SET-025 / SET-026 (T-247-b): the terminal options that need a rule, not just a switch. Read from
// the settings with a wrong or missing value corrected. Pure; the panes and the page read these.
import type { Platform } from "../keys/actions";
import type { ShellEntry } from "./shellChoice";
import { autoPowerShell } from "./shellChoice";

export type Auto = "auto" | "on" | "off";
const AUTO: readonly Auto[] = ["auto", "on", "off"];
const autoOf = (v: unknown): Auto | null => (AUTO.includes(v as Auto) ? (v as Auto) : null);

export const INPUT_FIELDS = {
  ligatures: "terminalLigatures",
  gpu: "terminalGpu", // the field renderer.ts already reads: false still means off
  middleClick: "terminalMiddleClickPaste",
  osc52: "terminalOsc52",
  /** VIEW-110: set when the user flips the OSC 52 switch on the current page; an off saved before it is overridden once. */
  osc52Chosen: "terminalOsc52Chosen",
  hidePointer: "terminalHidePointer",
  focusFollowsMouse: "terminalFocusFollowsMouse",
  fullScreenScroll: "terminalFullScreenScroll",
  optionAsAlt: "terminalOptionAsAlt",
  yenBackslash: "terminalYenBackslash",
  powershell: "powershellVersion",
  /** NATIVE-TERMINAL.md: panes drawn by the Windows Terminal engine (experimental, off by default). */
  native: "terminalNative",
  /** Kept-warm shell: a shell kept started per open folder, so the next new terminal opens at once (off by default). */
  warmShell: "terminalWarmShell",
} as const;

/** Families that ship programming ligatures: ligatures on "auto" turn on only for these. */
const LIGATURE_FAMILIES = ["fira code", "firacode", "jetbrains mono", "jetbrainsmono", "cascadia code", "cascadiacode", "iosevka", "hasklig", "victor mono", "monaspace", "geist mono", "maple mono", "lilex"];

/** Ligatures: a saved on/off wins; automatic follows the chosen font. */
export function ligaturesOn(mode: Auto, family: string): boolean {
  if (mode !== "auto") return mode === "on";
  const f = family.toLowerCase();
  return LIGATURE_FAMILIES.some((n) => f.includes(n));
}

/** GPU drawing: "off" and "on" are the user's word; automatic needs WebGL2 and not a software renderer. A saved false (older boolean) is off. */
export function gpuMode(s: Record<string, unknown>): Auto {
  const v = s[INPUT_FIELDS.gpu];
  return v === false ? "off" : v === true ? "on" : (autoOf(v) ?? "auto");
}
export function preferGpu(mode: Auto, host: { webgl2: boolean; software: boolean }): boolean {
  if (mode === "off") return false;
  if (mode === "on") return host.webgl2;
  return host.webgl2 && !host.software;
}

export type InputPrefs = {
  ligatures: Auto;
  gpu: Auto;
  /** Middle-click pastes the primary selection: on for Linux and macOS users, Windows users opt in. */
  middleClick: boolean;
  /** Programs may set the clipboard through OSC 52. */
  osc52: boolean;
  hidePointer: boolean;
  focusFollowsMouse: boolean;
  /** Lines per wheel step in a full-screen text program (an alternate screen). */
  fullScreenScroll: number;
  optionAsAlt: Auto;
  yenBackslash: boolean;
  powershell: "auto" | "7" | "5";
  /** Panes drawn by the Windows Terminal engine instead of xterm (NATIVE-TERMINAL.md). Off unless set to true. */
  native: boolean;
  /** A shell kept ready per open folder for the next new terminal (src-tauri terminal.rs WARM_FIELD). Off unless set to true. */
  warmShell: boolean;
};

export const FULL_SCREEN_SCROLL = { min: 1, max: 20, start: 1 }; // TERM-089: one report per notch inside full-screen programs

const bool = (v: unknown, start: boolean) => (typeof v === "boolean" ? v : start);

export function readInput(s: Record<string, unknown>, platform: Platform): InputPrefs {
  const n = Number(s[INPUT_FIELDS.fullScreenScroll]);
  return {
    ligatures: autoOf(s[INPUT_FIELDS.ligatures]) ?? "auto",
    gpu: gpuMode(s),
    middleClick: bool(s[INPUT_FIELDS.middleClick], platform !== "win32"),
    osc52: osc52On(s),
    hidePointer: s[INPUT_FIELDS.hidePointer] === true,
    focusFollowsMouse: s[INPUT_FIELDS.focusFollowsMouse] === true,
    fullScreenScroll: Number.isFinite(n) && s[INPUT_FIELDS.fullScreenScroll] !== "" && s[INPUT_FIELDS.fullScreenScroll] !== null ? Math.min(FULL_SCREEN_SCROLL.max, Math.max(FULL_SCREEN_SCROLL.min, Math.round(n))) : FULL_SCREEN_SCROLL.start,
    optionAsAlt: autoOf(s[INPUT_FIELDS.optionAsAlt]) ?? "auto",
    yenBackslash: s[INPUT_FIELDS.yenBackslash] === true,
    powershell: s[INPUT_FIELDS.powershell] === "7" || s[INPUT_FIELDS.powershell] === "5" ? s[INPUT_FIELDS.powershell] : "auto",
    native: s[INPUT_FIELDS.native] === true,
    warmShell: s[INPUT_FIELDS.warmShell] === true,
  } as InputPrefs;
}

/** VIEW-110: programs may copy to the clipboard by default. An off saved by an older build (no "chosen" mark) is
 *  overridden once: it reads as on until the user turns it off again on the current settings page, which saves the mark. */
export const osc52On = (s: Record<string, unknown>): boolean => s[INPUT_FIELDS.osc52Chosen] !== true || s[INPUT_FIELDS.osc52] !== false;

/** What the settings page saves when the user flips the OSC 52 switch: the value and the mark that it was chosen. */
export const osc52Save = (on: boolean): Record<string, unknown> => ({ [INPUT_FIELDS.osc52]: on, [INPUT_FIELDS.osc52Chosen]: true });

/** A mouse button press in a terminal: should it paste the primary selection? Only the middle button, only when switched on. */
export const pastesOnMiddle = (p: InputPrefs, button: number): boolean => button === 1 && p.middleClick;

/** xterm's macOptionIsMeta: only on macOS; automatic keeps Option typing its characters unless the layout has none to lose (US-style). */
export function optionIsMeta(p: InputPrefs, platform: Platform, layoutTypesWithOption: boolean): boolean {
  if (platform !== "darwin") return false;
  return p.optionAsAlt === "auto" ? !layoutTypesWithOption : p.optionAsAlt === "on";
}

/** A Japanese keyboard's Yen key types a backslash when this is on (U+00A5 in, U+005C out). */
export const yenToBackslash = (p: InputPrefs, data: string): string => (p.yenBackslash ? data.split("¥").join("\\") : data);

/** The pointer hides while typing and shows again on the next move. */
export const pointerHidden = (p: InputPrefs, typing: boolean): boolean => p.hidePointer && typing;

/**
 * SET-026: the PowerShell a "PowerShell" default opens. 7 and 5 are the user's word (falling back to the
 * other when the pick is not installed); automatic favours PowerShell 7 when it is present.
 */
export function pickPowerShell(shells: ShellEntry[], version: InputPrefs["powershell"]): ShellEntry | null {
  const want = version === "7" ? "pwsh" : version === "5" ? "powershell" : null;
  return (want && shells.find((s) => s.id === want)) || autoPowerShell(shells);
}

/** The PowerShell version card and the default shell setting exist on Windows only. */
export const shellCardShown = (platform: Platform): boolean => platform === "win32";
