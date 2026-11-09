// T-706 / DT-C142: a surface whose code prefetch() has already read draws on its first open without
// suspending, so a full-page screen never flashes its "Loading…" once the window has been up a moment.
// A file of its own: prefetch() reads every deferred() in the module graph, and pages.test.ts has many.
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { installDom, mount, settle } from "../tasks/fakeDom";

const g = globalThis as { requestIdleCallback?: (f: () => void, opts?: { timeout: number }) => void };
afterEach(() => {
  delete g.requestIdleCallback;
});

test("a screen prefetch has already read draws straight away, with no fallback frame", async () => {
  const { doc } = installDom();
  const { deferred, prefetch } = await import("./deferred");
  const drawn: string[] = [];
  const Spy = () => (drawn.push("fallback"), null);
  const Screen = deferred(() => Promise.resolve({ default: () => createElement("main", null, "Ready") }), createElement(Spy), { prefetch: true });
  g.requestIdleCallback = (f) => f();
  prefetch(() => {});
  await settle();
  const m = await mount(createElement(Screen), doc);
  expect(m.container.textContent).toBe("Ready");
  expect(drawn).toEqual([]);
  await m.unmount();
});

test("DT-C230: prefetch reads the marked surfaces at the first idle moment and every other one about 10 s later", async () => {
  const { deferred, prefetch, LATE_PREFETCH_MS } = await import("./deferred");
  const read: string[] = [];
  const mod = (name: string) => () => (read.push(name), Promise.resolve({ default: () => null }));
  deferred(mod("page"));
  deferred(mod("dialog"), createElement("p", null, "Loading…"));
  deferred(mod("editor"), undefined, { prefetch: true });
  const idles: Array<number | undefined> = [];
  g.requestIdleCallback = (f, opts) => (idles.push(opts?.timeout), f());
  const later: Array<{ f: () => void; ms: number }> = [];
  prefetch((f, ms) => void later.push({ f, ms }));
  await settle();
  expect(read).toEqual(["editor"]);
  expect(later.map((l) => l.ms)).toEqual([LATE_PREFETCH_MS]);
  expect(LATE_PREFETCH_MS).toBe(10_000);
  later[0].f();
  await settle();
  expect(read.filter((r) => r !== "editor").sort()).toEqual(["dialog", "page"]);
  expect(idles).toEqual([undefined, 5_000]); // the late step waits for an idle moment, at most 5 s
});

test("DT-C230: the editor, the browser pane and the surfaces with no placeholder are the ones read first", () => {
  const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
  const marks = (rel: string) => [...nodeFs.readFileSync(new URL(rel, import.meta.url), "utf8").matchAll(/const (\w+) = deferred\(.*\{ prefetch: true \}/g)].map((m) => m[1]);
  expect(marks("./panes.tsx")).toEqual(["EditorPane", "BrowserPane"]);
  expect(marks("./pages.tsx")).toEqual(["PlanSheet", "SettingsPage"]);
  expect(marks("../shell/window/Dialogs.tsx")).toEqual(["TabMenu"]);
});
