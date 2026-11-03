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
  const Screen = deferred(() => Promise.resolve({ default: () => createElement("main", null, "Ready") }), createElement(Spy));
  g.requestIdleCallback = (f) => f();
  prefetch();
  await settle();
  const m = await mount(createElement(Screen), doc);
  expect(m.container.textContent).toBe("Ready");
  expect(drawn).toEqual([]);
  await m.unmount();
});
