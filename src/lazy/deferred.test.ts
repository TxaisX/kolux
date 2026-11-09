// T-706 / DT-C142: a surface whose code prefetch() has already read draws on its first open without
// suspending, so a full-page screen never flashes its "Loading…" once the window has been up a moment.
// A file of its own: prefetch() reads every deferred() in the module graph, and pages.test.ts has many.
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { installDom, mount, settle } from "../tasks/fakeDom";

const g = globalThis as { requestIdleCallback?: (f: () => void) => void };
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

test("DT-C230: prefetch reads only the marked surfaces, at the first idle moment; the rest load on first open", async () => {
  const { doc } = installDom();
  const { deferred, prefetch } = await import("./deferred");
  const read: string[] = [];
  const mod = (name: string) => () => (read.push(name), Promise.resolve({ default: () => createElement("p", null, name) }));
  const Page = deferred(mod("page"));
  deferred(mod("dialog"), createElement("p", null, "Loading…"));
  deferred(mod("editor"), undefined, { prefetch: true });
  let idles = 0;
  g.requestIdleCallback = (f) => (idles++, f());
  const later: Array<{ f: () => void; ms: number }> = [];
  prefetch((f, ms) => void later.push({ f, ms }));
  await settle();
  expect([read, idles, later]).toEqual([["editor"], 1, []]); // nothing scheduled for later
  const m = await mount(createElement(Page), doc);
  await settle();
  expect(read).toEqual(["editor", "page"]); // read when first opened, and only then
  expect(m.container.textContent).toBe("page");
  await m.unmount();
  expect(read).not.toContain("dialog");
});

test("DT-C230: without an idle callback the marked surfaces are read 1.5 s after the first frame", async () => {
  const { deferred, prefetch } = await import("./deferred");
  const read: string[] = [];
  deferred(() => (read.push("plan"), Promise.resolve({ default: () => null })), undefined, { prefetch: true });
  deferred(() => (read.push("other"), Promise.resolve({ default: () => null })));
  const later: Array<{ f: () => void; ms: number }> = [];
  prefetch((f, ms) => void later.push({ f, ms }));
  expect(later.map((l) => l.ms)).toEqual([1500]);
  later[0].f();
  await settle();
  expect(read).toContain("plan");
  expect(read).not.toContain("other");
});

test("DT-C230: the editor, the browser pane and the surfaces with no placeholder are the ones read first", () => {
  const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
  const marks = (rel: string) => [...nodeFs.readFileSync(new URL(rel, import.meta.url), "utf8").matchAll(/const (\w+) = deferred\(.*\{ prefetch: true \}/g)].map((m) => m[1]);
  expect(marks("./panes.tsx")).toEqual(["EditorPane", "BrowserPane"]);
  expect(marks("./pages.tsx")).toEqual(["PlanSheet", "SettingsPage"]);
  expect(marks("../shell/window/Dialogs.tsx")).toEqual(["TabMenu"]);
});
