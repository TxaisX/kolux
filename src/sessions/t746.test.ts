// T-746 (DT-C182, Polish C): New agent tab and Show Space have Windows and Linux chords; the review "+" shows on
// the cursor line while the diff editor has keyboard focus; the past-session list draws 200 rows at a time with
// Show more; the auto-PR page asks for every project's workspaces at once.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { chordsOf, resolve } from "../keys/keymap";
import AgentsPanel from "./AgentsPanel";
import { remember } from "./refresh";

const calls: Array<{ cmd: string; done?: (v: unknown) => void }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd == "project_list"
      ? Promise.resolve([1, 2, 3].map((n) => ({ id: `p${n}`, name: `P${n}` })))
      : new Promise((done) => calls.push({ cmd, done })),
}));

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");

test("T-746: New agent tab is Mod+Alt+T and Show Space is Mod+Alt+S on every platform; Floor stays unbound (HID-003)", () => {
  for (const os of ["win32", "linux", "darwin"] as const) {
    const map = resolve({}, os);
    expect([chordsOf(map, "tab.newAgent"), chordsOf(map, "view.space"), chordsOf(map, "view.floor"), map.clashes]).toEqual([["Mod+Alt+T"], ["Mod+Alt+S"], [], []]);
  }
});

test("T-746: the review + shows on the cursor line while the editor has focus, not only on hover", () => {
  const css = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  expect(css).toMatch(/\.cm-focused \.cm-note-gutter \.cm-activeLineGutter \.note-plus \{\s*opacity: 1/);
});

test("T-746: with Unlimited, 250 sessions draw 200 rows and Show more; group headers keep their full counts", () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ agent: i < 150 ? "claude" : "codex", id: `s${i}`, title: `T${i}`, modifiedMs: Date.now() - i * 1000, bytes: 10, turns: 2, dir: "C:/w/a" }));
  remember(JSON.stringify([false, ["C:/w/a"], null]), rows);
  const props = { settings: { sessionListView: { depth: null, group: "agent" } }, onSave: () => {}, activeDir: "C:/w/a", projectDirs: [], projects: [{ path: "C:/w" }], rescanKey: 0, visible: true, shell: null, onResume: () => {} };
  const html = renderToString(createElement(AgentsPanel, props)).replace(/<!-- -->/g, "");
  expect(html.split('class="agents-row"').length - 1).toBe(200);
  expect(html).toContain("Show more (50 not shown)");
  expect(html).toContain("claude (150)");
  expect(html).toContain("codex (100)");
});

test("T-746: the auto-PR page asks for every project's workspaces before any answers, and keeps project order", async () => {
  const { loadEntries } = await import("../settings/autoPr");
  const out = loadEntries();
  await new Promise((r) => setTimeout(r, 0));
  expect(calls.map((c) => c.cmd)).toEqual(["workspace_list", "workspace_list", "workspace_list"]);
  [...calls].reverse().forEach((c, i) => c.done!([{ path: `C:/w/${2 - i}`, name: `W${2 - i}`, isMain: false }]));
  expect((await out).map((e) => e.name)).toEqual(["W0", "W1", "W2"]);
});
