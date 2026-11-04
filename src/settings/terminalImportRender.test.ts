// TERM-099 / TERM-100 (T-307, FIX-3b): the two "Bring in" boxes of Settings > Terminal, driven through the
// real components. There is no DOM test renderer in this repo, so React's useState is swapped for a tiny
// runtime (state slots, a redraw by hand), the same way useWizard.test.ts does it. What is checked is
// what the box does: a save that did not reach the disk leaves the window unpainted and says so, and
// the preview is the plan that Bring in saves (a scheme refused at the cap says "Will not add").
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ slots: [] as unknown[], i: 0, painted: 0, disk: {} as Record<string, unknown>, files: [] as unknown[], themes: {} as Record<string, string | null>, warp: [] as unknown[], saves: [] as Record<string, unknown>[], reachesDisk: false }));

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  function useState<T>(init: T | (() => T)) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = typeof init === "function" ? (init as () => T)() : init;
    const set = (v: T | ((x: T) => T)) => void (h.slots[k] = typeof v === "function" ? (v as (x: T) => T)(h.slots[k] as T) : v);
    return [h.slots[k] as T, set] as const;
  }
  return { ...real, useState, default: { ...real, useState } };
});
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: { name: string }) => {
    if (cmd === "term_import_ghostty") return h.files;
    if (cmd === "term_import_ghostty_theme") return h.themes[args!.name] ?? null;
    if (cmd === "term_import_warp") return h.warp;
    if (cmd === "get_settings") return { ...h.disk };
    throw new Error("unexpected " + cmd);
  },
}));
vi.mock("../theme", async (orig) => ({ ...(await orig<typeof import("../theme")>()), applyAppearance: () => void h.painted++ }));

const { GhosttyImportBox, WarpImportBox } = await import("./TerminalImport");

type Props = Parameters<typeof GhosttyImportBox>[0];
type El = { type?: unknown; props: { children?: ReactNode; onClick?: () => void; onChange?: (e: { target: { checked: boolean } }) => void; "aria-label"?: string } };

const text = (n: ReactNode): string => {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(text).join(" ");
  return text((n as El).props.children);
};
const find = (n: ReactNode, pick: (e: El) => boolean): El | null => {
  if (n === null || typeof n !== "object") return null;
  if (Array.isArray(n)) return n.map((c) => find(c, pick)).find(Boolean) ?? null;
  const e = n as El;
  return pick(e) ? e : find(e.props.children, pick);
};
const button = (tree: ReactNode, label: string) => find(tree, (e) => e.type === "button" && text(e.props.children).replace(/\s+/g, " ").trim() === label);
const settle = () => new Promise((r) => setTimeout(r, 0));

/** Mounts a box, runs its first "Look for" button, and returns a way to redraw and click. */
async function open(Box: (p: Props) => ReactNode, look: string, props: Props) {
  h.slots = [];
  const draw = () => {
    h.i = 0;
    return Box(props);
  };
  button(draw(), look)!.props.onClick!();
  await settle();
  return {
    draw,
    async click(label: string) {
      button(draw(), label)!.props.onClick!();
      await settle();
    },
  };
}

const scheme = (name: string) => ({ name, background: "#000000", foreground: "#ffffff" });
const ghosttyFiles = [{ label: "config", text: "font-size = 14\ntheme = Night\n" }];
// A save that settles without error. When it reaches the disk the settings read back match the patch.
const makeSave = (settings: Record<string, unknown>) => async (patch: Record<string, unknown>) => {
  h.saves.push(patch);
  if (h.reachesDisk) Object.assign(h.disk, patch);
  void settings;
};

beforeEach(() => {
  h.painted = 0;
  h.saves = [];
  h.disk = {};
  h.files = ghosttyFiles;
  h.themes = { Night: "background = 000000\nforeground = ffffff\n" };
  h.warp = [{ name: "night.yaml", text: "accent: '#1b8fe3'\nbackground: '#1e1e1e'\nforeground: '#e0e0e0'\nterminal_colors:\n  bright:\n    black: '#555555'\n  normal:\n    black: '#000000'\n" }];
  h.reachesDisk = false;
});

test("Ghostty: a save that did not reach the disk leaves the window unpainted and shows the failure line", async () => {
  const settings = {};
  const box = await open(GhosttyImportBox, "Look for my Ghostty settings", { settings, save: makeSave(settings) });
  expect(text(box.draw())).toContain("Will add the colour scheme Night.");
  await box.click("Bring in");
  expect(h.saves).toHaveLength(1);
  expect(h.painted).toBe(0);
  const shown = text(box.draw());
  expect(shown).toContain("The import could not be saved, so nothing was changed. Try again.");
  expect(shown).not.toContain("Set ");
  expect(button(box.draw(), "Bring in")).not.toBeNull(); // the import stays open to try again
});

test("Ghostty: when the save reaches the disk the window is painted once and the result is shown", async () => {
  const settings = {};
  h.reachesDisk = true;
  const box = await open(GhosttyImportBox, "Look for my Ghostty settings", { settings, save: makeSave(settings) });
  await box.click("Bring in");
  expect(h.painted).toBe(1);
  const shown = text(box.draw());
  expect(shown).not.toContain("could not be saved");
  expect(shown).toContain("Added");
});

test("Ghostty: with 40 schemes saved the preview says Will not add, and never Will add", async () => {
  const settings = { terminalCustomSchemes: Array.from({ length: 40 }, (_, i) => scheme(`S${i}`)) };
  const box = await open(GhosttyImportBox, "Look for my Ghostty settings", { settings, save: makeSave(settings) });
  const shown = text(box.draw());
  expect(shown).toContain("Will not add Night, because you already have 40 custom schemes. Remove one first.");
  expect(shown).not.toContain("Will add");
});

test("Warp: a save that did not reach the disk leaves the window unpainted and shows the failure line", async () => {
  const settings = {};
  const box = await open(WarpImportBox, "Look for my Warp themes", { settings, save: makeSave(settings) });
  const tick = find(box.draw(), (e) => e.props["aria-label"] === "Bring in night")!;
  tick.props.onChange!({ target: { checked: true } });
  await box.click("Bring in 1 scheme");
  expect(h.saves).toHaveLength(1);
  expect(h.painted).toBe(0);
  expect(text(box.draw())).toContain("The themes could not be saved, so nothing was changed. Try again.");
});
