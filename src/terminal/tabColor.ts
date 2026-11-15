// TERM-049 (T-102-c): Tab Color. A small palette, a colour per tab key kept in window state (like
// pinned tabs, not saved with the layout), and the menu rows that pick one. Pure.
import type { CSSProperties } from "react";
export type TabColor = { id: string; label: string; css: string };

/** TERM-133: nine colours plus "none" (ten choices), in the card order; css values are theme-safe mid tones read against both backgrounds. */
export const TAB_COLORS: readonly TabColor[] = [
  { id: "blue", label: "Blue", css: "#3e7bd9" },
  { id: "purple", label: "Purple", css: "#8e5cd6" },
  { id: "pink", label: "Pink", css: "#d6579b" },
  { id: "red", label: "Red", css: "#e5534b" },
  { id: "orange", label: "Orange", css: "#e08a3c" },
  { id: "yellow", label: "Yellow", css: "#c9a227" },
  { id: "green", label: "Green", css: "#46a758" },
  { id: "teal", label: "Teal", css: "#2ba5a5" },
  { id: "grey", label: "Grey", css: "#8b8f98" },
];

export type TabColors = Record<number, string>;

export const isTabColor = (id: unknown): id is string => typeof id === "string" && TAB_COLORS.some((c) => c.id === id);

/** The colour picked for a tab, or null for none. */
export const colorOf = (colors: TabColors, key: number): TabColor | null => TAB_COLORS.find((c) => c.id === colors[key]) ?? null;

/** Pick `id` for a tab (null or an unknown id clears it); choosing the colour it already has clears it too. */
export function setTabColor(colors: TabColors, key: number, id: string | null): TabColors {
  const next = { ...colors };
  if (id === null || !isTabColor(id) || next[key] === id) delete next[key];
  else next[key] = id;
  return next;
}

/** Drop the entries of tabs that closed. */
export const forgetColors = (colors: TabColors, gone: number[]): TabColors => Object.fromEntries(Object.entries(colors).filter(([k]) => !gone.includes(Number(k))));

/** TERM-133: the tab's small coloured dot: the colour goes to the tab as --tab-dot and shell.css draws the dot
 *  before the title; nothing for none, and the terminal's own colours are untouched. */
export const tabStyle = (colors: TabColors, key: number): CSSProperties | undefined => {
  const c = colorOf(colors, key);
  return c ? ({ "--tab-dot": c.css } as CSSProperties) : undefined;
};

export type TabMenuEntry =
  | { id: "rename"; label: string }
  | { id: "pin"; label: string }
  | { id: "color"; label: string }
  | { id: "splitRight" | "splitDown"; label: string; disabled: boolean; why: string | null }
  | { id: "close"; label: string };

/**
 * TERM-049: the entries before the close items, in the order the card lists them: Change title
 * (only for terminal and agent tabs), pin or unpin, Tab color, Split right, Split down.
 */
export function tabMenuHead(kind: string | undefined, pinned: boolean, split: { enabled: boolean; why: string | null }): TabMenuEntry[] {
  const out: TabMenuEntry[] = [];
  if (!kind) out.push({ id: "rename", label: "Change title" });
  out.push({ id: "pin", label: pinned ? "Unpin tab" : "Pin tab" });
  out.push({ id: "color", label: "Tab color" });
  out.push({ id: "splitRight", label: "Split right", disabled: !split.enabled, why: split.why });
  out.push({ id: "splitDown", label: "Split down", disabled: !split.enabled, why: split.why });
  return out;
}
