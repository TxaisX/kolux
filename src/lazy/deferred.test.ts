// T-706 / DT-C142: a surface whose code prefetch() has already read draws on its first open without
// suspending, so a full-page screen never flashes its "Loading…" once the window has been up a moment.
// A file of its own: prefetch() reads every deferred() in the module graph, and pages.test.ts has many.
import { Component, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { installDom, mount, settle } from "../tasks/fakeDom";

const g = globalThis as { requestIdleCallback?: (f: () => void) => void };
afterEach(() => {
  delete g.requestIdleCallback;
});
beforeEach(async () => {
  (await import("./deferred")).forgetStages();
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

const mod = (read: string[], name: string) => () => (read.push(name), Promise.resolve({ default: () => createElement("p", null, name) }));

// A clock and a timer list the test turns by hand: `later` queues, `advance` runs what is due.
function clock() {
  let t = 0;
  const timers: Array<{ f: () => void; at: number }> = [];
  return {
    now: () => t,
    later: (f: () => void, ms: number) => void timers.push({ f, at: t + ms }),
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        t = Math.max(t, due.at);
        due.f();
        await settle();
      }
      t = end;
    },
  };
}

test("DT-C230 amended: stage 1 is read at the first idle moment; stages 2 and 3 come later, in order; the rest load on first open", async () => {
  const { doc } = installDom();
  const { deferred, prefetch } = await import("./deferred");
  const read: string[] = [];
  const Page = deferred(mod(read, "page"));
  deferred(mod(read, "dialog"), createElement("p", null, "Loading…"));
  deferred(mod(read, "editor"), undefined, { warm: 3 });
  deferred(mod(read, "board"), undefined, { warm: 2 });
  deferred(mod(read, "chooser"), undefined, { warm: 1 });
  deferred(mod(read, "menu"), undefined, { prefetch: true }); // the older spelling is stage 1
  const c = clock();
  const idles: Array<() => void> = [];
  prefetch(c.later, { idle: (f) => void idles.push(f), now: c.now, busy: () => false });
  expect(idles).toHaveLength(1);
  idles.shift()!();
  await settle();
  expect(read).toEqual(["chooser", "menu"]); // only stage 1 at the first idle moment
  const drain = async () => {
    for (let n = 0; n < 5 && idles.length; n++) idles.shift()!(), await settle();
  };
  await c.advance(1900);
  await drain();
  expect(read).toEqual(["chooser", "menu"]); // stage 2 is not due yet
  await c.advance(200); // 2.1 s
  await drain();
  expect(read).toEqual(["chooser", "menu", "board"]);
  await c.advance(5800); // 7.9 s
  await drain();
  expect(read).not.toContain("editor");
  await c.advance(200); // 8.1 s
  await drain();
  expect(read).toEqual(["chooser", "menu", "board", "editor"]);
  const m = await mount(createElement(Page), doc);
  await settle();
  expect(read.slice(-1)).toEqual(["page"]); // read when first opened, and only then
  expect(m.container.textContent).toBe("page");
  await m.unmount();
  expect(read).not.toContain("dialog");
});

test("DT-C230 amended: stages 2 and 3 wait while the user is typing, and read one module per idle moment", async () => {
  const { deferred, prefetch } = await import("./deferred");
  const read: string[] = [];
  deferred(mod(read, "a"), undefined, { warm: 2 });
  deferred(mod(read, "b"), undefined, { warm: 2 });
  deferred(mod(read, "c"), undefined, { warm: 3 });
  const c = clock();
  let busy = false;
  const idles: Array<() => void> = [];
  prefetch(c.later, { idle: (f) => void idles.push(f), now: c.now, busy: () => busy });
  idles.shift()!();
  await settle();
  busy = true;
  await c.advance(6000); // past stage 2's time, user active throughout
  expect(idles).toHaveLength(0);
  expect(read).toEqual([]);
  busy = false;
  await c.advance(600);
  expect(idles).toHaveLength(1); // one module's turn, not all of them
  idles.shift()!();
  await settle();
  expect(read).toEqual(["a"]);
  await c.advance(0);
  idles.shift()!();
  await settle();
  expect(read).toEqual(["a", "b"]);
  await c.advance(0);
  expect(idles).toHaveLength(0); // 6.6 s: stage 3 is not due until 8 s
  await c.advance(1500);
  idles.shift()!();
  await settle();
  expect(read).toEqual(["a", "b", "c"]); // stage 3 after its 8 s
});

test("DT-C230 amended: the default busy check sees a key or a press in the last 500 ms", async () => {
  const added: Record<string, () => void> = {};
  const g = globalThis as { addEventListener?: unknown };
  const before = g.addEventListener;
  g.addEventListener = (type: string, f: () => void) => void (added[type] = f);
  try {
    const { deferred, prefetch } = await import("./deferred");
    const read: string[] = [];
    deferred(mod(read, "a"), undefined, { warm: 2 });
    const c = clock();
    const idles: Array<() => void> = [];
    prefetch(c.later, { idle: (f) => void idles.push(f), now: c.now });
    expect(Object.keys(added).sort()).toEqual(["keydown", "pointerdown"]);
    idles.shift()!();
    await settle();
    await c.advance(1900);
    added.keydown(); // at 1.9 s
    await c.advance(300); // stage 2 is due at 2 s but the key was 400 ms ago
    expect(idles).toHaveLength(0);
    await c.advance(300);
    expect(idles).toHaveLength(1);
  } finally {
    g.addEventListener = before;
  }
});

test("DT-C230 amended: without an idle callback stage 1 is read 1.5 s after the first frame", async () => {
  const { deferred, prefetch } = await import("./deferred");
  const read: string[] = [];
  deferred(mod(read, "plan"), undefined, { warm: 1 });
  deferred(mod(read, "other"));
  const later: Array<{ f: () => void; ms: number }> = [];
  prefetch((f, ms) => void later.push({ f, ms }), { now: () => 0, busy: () => false });
  expect(later.map((l) => l.ms)).toEqual([1500]);
  later[0].f();
  await settle();
  expect(read).toContain("plan");
  expect(read).not.toContain("other");
});

test("warm() reads the code now, so the first draw is immediate with no fallback frame", async () => {
  const { doc } = installDom();
  const { deferred } = await import("./deferred");
  const drawn: string[] = [];
  const Spy = () => (drawn.push("fallback"), null);
  const Screen = deferred(() => Promise.resolve({ default: () => createElement("main", null, "Ready") }), createElement(Spy));
  Screen.warm();
  await settle();
  const m = await mount(createElement(Screen), doc);
  expect(m.container.textContent).toBe("Ready");
  expect(drawn).toEqual([]);
  await m.unmount();
});

test("warm() on a module that fails to load does not throw, and the surface still loads on demand", async () => {
  const { deferred } = await import("./deferred");
  let tries = 0;
  const S = deferred(() => (++tries === 1 ? Promise.reject<{ default: () => null }>(new Error("offline")) : Promise.resolve({ default: () => null })));
  expect(() => S.warm()).not.toThrow();
  await settle();
  S.warm();
  await settle();
  expect(tries).toBe(2);
});

// Behind lazy() and Suspense, a surface opened before its code was read came about 300 ms after its fallback,
// however fast the code arrived (React holds content that suspended): Add Project opened in 11 ms while it was
// in the first load and in 310 ms on its first open behind lazy(). The surface is drawn by a state change now.
test("a surface opened before its code was read shows its fallback, then itself as soon as the code arrives, read once", async () => {
  const { doc } = installDom();
  const { deferred } = await import("./deferred");
  type Mod = { default: () => ReturnType<typeof createElement> };
  let give: (m: Mod) => void = () => {};
  let reads = 0;
  const S = deferred(() => (reads++, new Promise<Mod>((ok) => (give = ok))), createElement("p", null, "Loading…"));
  const a = await mount(createElement(S), doc);
  const b = await mount(createElement(S), doc); // a second place asks for the same code
  expect(a.container.textContent).toBe("Loading…");
  give({ default: () => createElement("main", null, "Ready") });
  await settle();
  expect(a.container.textContent).toBe("Ready");
  expect(b.container.textContent).toBe("Ready");
  expect(reads).toBe(1);
  const c = await mount(createElement(S), doc); // and a later open draws it at once
  expect(c.container.textContent).toBe("Ready");
  await a.unmount();
  await b.unmount();
  await c.unmount();
});

test("read() hands back the same read for a caller that waits for it (the Settings pages' warm-up)", async () => {
  const { deferred } = await import("./deferred");
  let reads = 0;
  const S = deferred(() => (reads++, Promise.resolve({ default: () => null })));
  await Promise.all([S.read(), S.read()]);
  await S.read(); // already read: answers without reading again
  expect(reads).toBe(1);
  const Bad = deferred(() => Promise.reject<{ default: () => null }>(new Error("offline")));
  await expect(Bad.read()).rejects.toThrow("offline"); // the warm-up hears about a failed read and leaves it for the click
});

test("a read that fails is reported by the boundary above, and the next open reads again", async () => {
  const { doc } = installDom();
  const { deferred } = await import("./deferred");
  class Catch extends Component<{ children: ReactNode }, { error: string | null }> {
    state = { error: null as string | null };
    static getDerivedStateFromError(e: unknown) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    render() {
      return this.state.error ? createElement("p", null, `failed: ${this.state.error}`) : this.props.children;
    }
  }
  let tries = 0;
  const S = deferred(() => (++tries === 1 ? Promise.reject<{ default: () => ReturnType<typeof createElement> }>(new Error("offline")) : Promise.resolve({ default: () => createElement("main", null, "Ready") })));
  const a = await mount(createElement(Catch, null, createElement(S)), doc);
  await settle();
  expect(a.container.textContent).toBe("failed: offline");
  await a.unmount();
  const b = await mount(createElement(Catch, null, createElement(S)), doc);
  await settle();
  expect(b.container.textContent).toBe("Ready");
  expect(tries).toBe(2);
  await b.unmount();
});

test("DT-C252: other code marked with ahead() is read once, in its stage, and the stage waits for it", async () => {
  installDom();
  const { ahead, deferred, prefetch } = await import("./deferred");
  const read: string[] = [];
  let finish: () => void = () => {};
  ahead(3, () => (read.push("settings pages"), new Promise<void>((done) => (finish = done))));
  deferred(mod(read, "editor"), undefined, { warm: 3 });
  deferred(mod(read, "chooser"), undefined, { warm: 1 });
  const c = clock();
  const idles: Array<() => void> = [];
  prefetch(c.later, { idle: (f) => void idles.push(f), now: c.now, busy: () => false });
  const drain = async () => {
    for (let n = 0; n < 5 && idles.length; n++) idles.shift()!(), await settle();
  };
  await drain();
  expect(read).toEqual(["chooser"]);
  await c.advance(8100);
  await drain();
  expect(read).toEqual(["chooser", "settings pages"]); // asked for in stage 3; the editor waits until it has arrived
  finish();
  await settle();
  await drain();
  expect(read).toEqual(["chooser", "settings pages", "editor"]);
});

test("DT-C230 amended: the stages are the ones named, by source", () => {
  const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
  const marks = (rel: string, stage: string) => [...nodeFs.readFileSync(new URL(rel, import.meta.url), "utf8").matchAll(new RegExp(`const (\\w+) = deferred\\(.*\\{ ${stage} \\}`, "g"))].map((m) => m[1]);
  expect(marks("./pages.tsx", "warm: 1")).toEqual(["HelpSheet", "ChooserPane"]);
  expect(marks("./pages.tsx", "warm: 2")).toEqual(["SettingsPage", "InboxView", "WorkspaceBoard", "AgentsPanel", "Explorer"]);
  expect(marks("./pages.tsx", "warm: 3")).toEqual(["PlanSheet"]); // imports the Markdown preview: far too big for stage 1
  expect(marks("./panes.tsx", "warm: 3")).toEqual(["EditorPane", "BrowserPane"]);
  expect(marks("../shell/window/Dialogs.tsx", "prefetch: true")).toEqual(["TabMenu"]); // the tab menu keeps the older spelling: stage 1
  expect(marks("./pages.tsx", "prefetch: true")).toEqual([]);
  // DT-C252: the Settings pages' own code is read in the last stage too.
  expect(nodeFs.readFileSync(new URL("./pages.tsx", import.meta.url), "utf8")).toMatch(/ahead\(3, \(\) => import\("\.\.\/settings\/SettingsPage"\)\.then\(\(m\) => m\.warmPages\(\)\)\);/);
});
