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
  prefetch();
  await settle();
  const m = await mount(createElement(Screen), doc);
  expect(m.container.textContent).toBe("Ready");
  expect(drawn).toEqual([]);
  await m.unmount();
});

test("DT-C230: prefetch reads only the surfaces marked for it; the rest wait for their first open", async () => {
  const { deferred, prefetch } = await import("./deferred");
  const read: string[] = [];
  const mod = (name: string) => () => (read.push(name), Promise.resolve({ default: () => null }));
  deferred(mod("page"));
  deferred(mod("dialog"), createElement("p", null, "Loading…"));
  deferred(mod("editor"), undefined, { prefetch: true });
  g.requestIdleCallback = (f) => f();
  prefetch();
  await settle();
  expect(read).toEqual(["editor"]);
});

test("DT-C230: of the pane bodies only the editor and the browser pane are marked for prefetch", () => {
  const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
  const src = nodeFs.readFileSync(new URL("./panes.tsx", import.meta.url), "utf8");
  const marked = [...src.matchAll(/export const (\w+) = deferred\(.*\{ prefetch: true \}/g)].map((m) => m[1]);
  expect(marked).toEqual(["EditorPane", "BrowserPane"]);
  const pages = nodeFs.readFileSync(new URL("./pages.tsx", import.meta.url), "utf8");
  expect(pages).not.toContain("prefetch: true");
});
