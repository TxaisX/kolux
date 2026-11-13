// APP-048 box 1 and APP-050 box 1, window half: a changed setting and a changed layout reach `settings_patch` (the command the
// Rust side writes to settings.json) at once or within 2 s, and the quit path flushes a pending layout before the window closes.
// evidence/cards-APP-048-050-patches.json holds the exact arguments; src-tauri/tests/cards_19.rs applies those same arguments
// through the real Store in a process that is then killed. The file is compared as parsed JSON and rewritten only with CARDS_REGEN=1.
// MIRROR src/App.tsx:508-512 (saveSetting: applySetting, then saveChanged) and src/App.tsx:1545-1551 (close handler: layoutSaver.flush()).
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ patches: [] as { set: Record<string, unknown>; remove: string[] }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { set: Record<string, unknown>; remove: string[] }) => {
    if (cmd === "settings_patch") h.patches.push(JSON.parse(JSON.stringify(args)));
    return Promise.resolve(null);
  },
}));

import { applySetting } from "../../projects/settingWrite";
import { saveLayout } from "../general";
import { saveChanged } from "../saveChanged";
import { LAYOUT_FIELD, restoreLayout, type SavedLayout } from "../../terminal/layout";
import { layoutWriter, MAX_WAIT_MS } from "../../terminal/layoutSave";

// src has no node types; the builtin modules come through process.getBuiltinModule (as keys/sessionKeys.test.ts does).
const process: any = (globalThis as any).process;
const builtin = (name: string): any => process.getBuiltinModule(name);
const fs = builtin("node:fs");
const path = builtin("node:path");
const FIXTURE: string = path.resolve(path.dirname(builtin("node:url").fileURLToPath(import.meta.url)), "../../../evidence/cards-APP-048-050-patches.json");
const layout: SavedLayout = {
  panes: [
    { key: 1, cwd: "C:/w/a", branch: null, agent: "shell", program: null, args: [] },
    { key: 2, cwd: "C:/w/a", branch: null, agent: "shell", program: null, args: [] },
  ],
  focused: 2,
  activeDir: "C:/w/a",
  stacked: {},
};
const expected = {
  setting: { set: { needsStrip: false }, remove: [] as string[] },
  layout: { set: { [LAYOUT_FIELD]: layout }, remove: [] as string[] },
};

beforeEach(() => {
  h.patches = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const writeLayout = (l: SavedLayout) => saveLayout(l, (v) => saveChanged({}, { [LAYOUT_FIELD]: v }));

test("the patch arguments are the ones the Rust side applies (fixture)", () => {
  if (process.env.CARDS_REGEN === "1") fs.writeFileSync(FIXTURE, JSON.stringify(expected, null, 2) + "\n");
  expect(JSON.parse(fs.readFileSync(FIXTURE, "utf8"))).toEqual(expected);
});

test("APP-048 box 1: a changed setting is sent to settings_patch the moment it changes, with no timer in between", () => {
  const cell = { current: { theme: "classic" } as Record<string, unknown> };
  const { was, next } = applySetting(cell, "needsStrip", false);
  void saveChanged(was, next);
  expect(h.patches).toEqual([expected.setting]); // synchronously: not one fake timer has run
  expect(vi.getTimerCount()).toBe(0);
});

test("APP-048 box 1: a changed layout is written within 2 s, even when the changes never go quiet", async () => {
  const w = layoutWriter(writeLayout);
  w.set({ ...layout, focused: 1 });
  expect(h.patches).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(400); // quiet for the usual 400 ms
  expect(h.patches).toHaveLength(1);
  let n = 0;
  for (let t = 0; t < 2500; t += 100) {
    w.set({ ...layout, focused: 2 + (n++ % 2) }); // a change every 100 ms, never quiet
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(h.patches.length).toBeGreaterThanOrEqual(2);
  expect(MAX_WAIT_MS).toBe(2000);
});

test("APP-050 box 1: quitting at once flushes the pending layout before the window closes, and it restores identical", async () => {
  const w = layoutWriter(writeLayout);
  w.set(layout);
  expect(w.pending()).toBe(true);
  expect(h.patches).toHaveLength(0);
  const saved = w.flush(); // the close handler's layoutSaver.flush()
  expect(h.patches).toEqual([expected.layout]); // sent before the window may close
  await saved;
  expect(w.pending()).toBe(false);
  await w.flush(); // nothing more to write
  expect(h.patches).toHaveLength(1);
  expect(restoreLayout(expected.layout.set[LAYOUT_FIELD])).toEqual(layout); // what the next launch reads back
});

test("APP-050 box 1: a layout equal to the last one written is not written again", async () => {
  const w = layoutWriter(writeLayout);
  w.set(layout);
  await w.flush();
  w.set(layout);
  await w.flush();
  expect(h.patches).toHaveLength(1);
});
