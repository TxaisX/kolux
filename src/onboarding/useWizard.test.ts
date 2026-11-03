// VIEW-114 (FIX-4, council AFTER 3): useWizard's close, reopen and added-project wiring, tested
// through the real hook. There is no DOM test renderer in this repo, so React's three hooks it uses
// are swapped for a tiny runtime (state slots, effects that run when their deps change, a redraw
// while state is dirty), the same way sidebarStart.test.ts does it. This replaces a scan of the
// hook's source text: what is checked here is what the hook does.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Effect = { deps: unknown[] | undefined; cleanup?: () => void };
const h = { slots: [] as unknown[], i: 0, effects: [] as Effect[], e: 0, queue: [] as (() => void)[], dirty: false };

vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  function useState<T>(init: T | (() => T)) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = typeof init === "function" ? (init as () => T)() : init;
    const set = (v: T | ((x: T) => T)) => {
      const next = typeof v === "function" ? (v as (x: T) => T)(h.slots[k] as T) : v;
      if (!Object.is(next, h.slots[k])) (h.slots[k] = next), (h.dirty = true);
    };
    return [h.slots[k] as T, set] as const;
  }
  function useRef<T>(init: T) {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = { current: init };
    return h.slots[k] as { current: T };
  }
  function useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    const k = h.e++;
    const prev = h.effects[k];
    if (prev && deps && prev.deps && deps.every((d, j) => Object.is(d, prev.deps![j]))) return;
    h.queue.push(() => {
      prev?.cleanup?.();
      const c = fn();
      h.effects[k] = { deps, cleanup: typeof c === "function" ? c : undefined };
    });
  }
  const hooks = { useState, useRef, useEffect };
  return { ...real, ...hooks, default: { ...real, ...hooks } };
});

const calls: string[] = [];
const closes: string[] = []; // T-612: each stored close's outcome
const store = { closeOk: true, reopenOk: true };
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { outcome?: string }) => {
    calls.push(cmd);
    if (cmd === "onboarding_close" && store.closeOk) closes.push(args?.outcome ?? "");
    if (cmd === "onboarding_get") return Promise.resolve({ step: 2 });
    if (cmd === "onboarding_close") return store.closeOk ? Promise.resolve() : Promise.reject(new Error("disk full"));
    if (cmd === "onboarding_reopen") return store.reopenOk ? Promise.resolve() : Promise.reject(new Error("locked"));
    return Promise.reject(new Error(`unexpected ${cmd}`));
  },
}));

let win: EventTarget;
const heard: string[] = [];
const toasts: string[] = [];
const started: string[] = [];
beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal("window", win);
  h.slots = [];
  h.effects = [];
  calls.length = 0;
  closes.length = 0;
  heard.length = 0;
  toasts.length = 0;
  started.length = 0;
  store.closeOk = true;
  store.reopenOk = true;
});
afterEach(() => vi.unstubAllGlobals());

async function mountWizard(settings: Record<string, unknown> = {}, activeDir: string | null = null) {
  const { useWizard } = await import("./useWizard");
  const { CHECKLIST_CHANGED } = await import("./firstRun");
  const { PROJECT_ADDED } = await import("./sidebar");
  win.addEventListener(CHECKLIST_CHANGED, () => heard.push("checklist"));
  win.addEventListener(PROJECT_ADDED, () => heard.push("project"));
  // FIX-5: an installed plain-terminal entry sits in the list, so a "terminal" default is stopped by the guard and not by a missing agent.
  const agents = [
    { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "C:/bin/claude" },
    { id: "terminal", name: "Terminal", program: "powershell", args: [], installed: true, path: "C:/bin/powershell" },
  ];
  const deps = {
    setToast: (t: string) => void toasts.push(t),
    agents,
    settings,
    activeDir,
    kitAIs: [],
    startIn: async (a: { id: string }, dir: string) => (started.push(`${a.id}@${dir}`), 1),
    startKit: async () => true,
    setKitConflict: () => {},
    setKits: () => {},
  };
  let out!: ReturnType<typeof useWizard>;
  const draw = () => {
    do {
      h.dirty = false;
      h.i = 0;
      h.e = 0;
      h.queue = [];
      out = useWizard(deps);
      for (const run of h.queue) run();
    } while (h.dirty);
  };
  const settle = async () => {
    for (let n = 0; n < 8; n++) {
      await new Promise((r) => setTimeout(r, 0));
      if (h.dirty) draw();
    }
  };
  draw();
  await settle();
  return { now: () => out, settle };
}

test("a failed close keeps the wizard open with a toast and tells the sidebar nothing; the retry closes it and tells the sidebar (VIEW-114, FIX-4)", async () => {
  const { openAt } = await import("./firstRun");
  const app = await mountWizard();
  expect(app.now().wizard).toBe(openAt({ step: 2 } as never));
  expect(app.now().wizard).not.toBeNull();
  store.closeOk = false;
  app.now().endWizard("dismissed");
  await app.settle();
  expect(app.now().wizard).not.toBeNull();
  expect(toasts).toHaveLength(1);
  expect(toasts[0]).toContain("disk full");
  expect(heard).toEqual([]);
  store.closeOk = true;
  expect(app.now().wizardClose.retry()).toBe(true);
  await app.settle();
  expect(app.now().wizard).toBeNull();
  expect(heard).toEqual(["checklist"]);
  expect(calls.filter((c) => c === "onboarding_close")).toHaveLength(2);
});

test("Help > Onboarding reopens on screen one and tells the sidebar; a second click inside half a second is ignored; a failed reopen only toasts (VIEW-114, FIX-4)", async () => {
  const { REOPEN_WIZARD } = await import("./firstRun");
  const app = await mountWizard();
  app.now().endWizard("dismissed");
  await app.settle();
  expect(app.now().wizard).toBeNull();
  heard.length = 0;
  win.dispatchEvent(new Event(REOPEN_WIZARD));
  win.dispatchEvent(new Event(REOPEN_WIZARD));
  await app.settle();
  expect(app.now().wizard).toBe(0);
  expect(calls.filter((c) => c === "onboarding_reopen")).toHaveLength(1);
  expect(heard).toEqual(["checklist"]);
  // A failed reopen (after the half second has passed) leaves the wizard as it was and says why.
  app.now().endWizard("dismissed");
  await app.settle();
  heard.length = 0;
  store.reopenOk = false;
  const realNow = Date.now;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10_000);
  try {
    win.dispatchEvent(new Event(REOPEN_WIZARD));
    await app.settle();
  } finally {
    vi.restoreAllMocks();
  }
  expect(app.now().wizard).toBeNull();
  expect(toasts[toasts.length - 1]).toContain("locked");
  expect(heard).toEqual([]);
});

test("every added project tells the sidebar before the first-folder check; the armed first folder starts the saved default agent once (VIEW-114, FIX-4)", async () => {
  const app = await mountWizard({ defaultAgent: "claude" });
  app.now().projectAdded("C:/p", null);
  expect(heard).toEqual(["project"]);
  expect(started).toEqual([]);
  app.now().firstFolder.current = true;
  app.now().projectAdded("C:/q", "main");
  app.now().projectAdded("C:/r", null);
  expect(heard).toEqual(["project", "project", "project"]);
  expect(started).toEqual(["claude@C:/q"]);
});

test("a plain terminal as the saved default starts nothing in the first folder (VIEW-114, FIX-4)", async () => {
  const app = await mountWizard({ defaultAgent: "terminal" });
  app.now().firstFolder.current = true;
  app.now().projectAdded("C:/q", null);
  expect(heard).toEqual(["project"]);
  expect(started).toEqual([]);
});

// T-612 (audit F08-onboarding-look-misc.2): since kits went (T-568), "Your work"'s Continue reaches the last screen with no
// workspace, and Open a session silently did nothing there. Now it leads to picking a folder and opens the session in it.
test("T-612 / 49-ux2: Open a session with no workspace yet opens Add Project, stores setup as completed only when the folder is added, and starts the session there, once", async () => {
  const { ADD_PROJECT } = await import("./firstRun");
  win.addEventListener(ADD_PROJECT, () => heard.push("add-project"));
  const app = await mountWizard(); // a new profile: no saved default agent, no workspace
  await app.now().wizardSession();
  await app.settle();
  // 49-ux2: Pick a folder hides the wizard and says why, but stores nothing until a folder was really added.
  expect(closes).toEqual([]);
  expect(app.now().wizard).toBeNull();
  expect(heard).toContain("add-project");
  expect(toasts).toHaveLength(1);
  expect(started).toEqual([]);
  app.now().projectAdded("C:/new", "main");
  await app.settle();
  expect(closes).toEqual(["completed"]);
  expect(started).toEqual(["claude@C:/new"]); // the agent Open a session would have used: the first one offered
  app.now().projectAdded("C:/other", null);
  expect(started).toEqual(["claude@C:/new"]);
});

test("49-ux2: Pick a folder cancelled, then Help > Onboarding: the wizard is back and a project added later does not complete setup", async () => {
  const { REOPEN_WIZARD } = await import("./firstRun");
  const app = await mountWizard();
  app.now().pickFolder();
  await app.settle();
  expect(app.now().wizard).toBeNull();
  expect(closes).toEqual([]);
  const realNow = Date.now;
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10_000);
  try {
    win.dispatchEvent(new Event(REOPEN_WIZARD));
    await app.settle();
  } finally {
    vi.restoreAllMocks();
  }
  expect(app.now().wizard).toBe(0);
  app.now().projectAdded("C:/later", null);
  await app.settle();
  expect(closes).toEqual([]);
  expect(started).toEqual([]);
});

test("T-612: with a workspace in front, Open a session starts the session there and closes setup as completed", async () => {
  const app = await mountWizard({}, "C:/w");
  await app.now().wizardSession();
  await app.settle();
  expect(started).toEqual(["claude@C:/w"]);
  expect(closes).toEqual(["completed"]);
  expect(heard.filter((x) => x === "add-project")).toEqual([]);
});
