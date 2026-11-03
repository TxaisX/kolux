// VIEW-114 (FIX-3, council FIX-SOON 3): the sidebar entry's re-read, tested through the real
// SidebarStart and useGuideState rather than a bare EventTarget. There is no DOM test renderer in
// this repo, so React's three hooks these components use are swapped for a tiny runtime that keeps
// state slots, runs an effect when its deps change and draws again while state is dirty. Children
// are never drawn (JSX only builds elements), so only SidebarStart's own hooks run.
// Limit (FIX-4): only useState, useRef and useEffect are swapped. If SidebarStart or useGuideState later
// uses useCallback or useMemo, the real hook throws outside a render and this file fails loudly (it
// fails safe); add the hook to the runtime below then. The checklist branch of the slot is covered by
// sidebar.test.ts (sidebarSlot), not here, since children are never drawn.
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
let record: unknown = null;
let patchFails = false;
const patches: unknown[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    calls.push(cmd);
    if (cmd === "settings_patch") {
      patches.push(args);
      if (patchFails) return Promise.reject(new Error("the settings file could not be written"));
    }
    const answers: Record<string, unknown> = {
      guide_get: record,
      get_settings: { notifyOnFinish: false },
      scm_gh_account: null,
      settings_patch: null,
      project_list: [],
      cli_status: { installed: false, onPath: false },
      skills_scan: { skills: [] },
    };
    return cmd in answers ? Promise.resolve(answers[cmd]) : Promise.reject(new Error(`unexpected ${cmd}`));
  },
}));

let win: EventTarget;
beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal("window", win);
  h.slots = [];
  h.effects = [];
  calls.length = 0;
  patches.length = 0;
  patchFails = false;
  record = { tipsSeen: [], visited: [], tried: [], toursSeen: [], toursAuto: null, firstRun: { closed: true, outcome: "dismissed", checklistDismissed: true, milestones: {} } };
});
afterEach(() => vi.unstubAllGlobals());

async function mount() {
  const { default: SidebarStart } = await import("./SidebarStart");
  let out: unknown = null;
  const draw = () => {
    do {
      h.dirty = false;
      h.i = 0;
      h.e = 0;
      h.queue = [];
      out = SidebarStart();
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
  return { out: () => out, settle };
}

const reads = () => calls.filter((c) => c === "cli_status").length;

test("a Setup Guide close or an added project makes SidebarStart read its steps again; the entry stays up meanwhile (VIEW-114, FIX-3)", async () => {
  const { GUIDE_CLOSED } = await import("./guide");
  const { PROJECT_ADDED } = await import("./sidebar");
  const app = await mount();
  expect(reads()).toBe(1);
  expect((app.out() as { props: { className: string } }).props.className).toBe("onb-entry");
  win.dispatchEvent(new Event(GUIDE_CLOSED));
  await app.settle();
  expect(reads()).toBe(2);
  win.dispatchEvent(new Event(PROJECT_ADDED));
  await app.settle();
  expect(reads()).toBe(3);
  expect((app.out() as { props: { className: string } }).props.className).toBe("onb-entry");
});

test("the first window focus after mount does not read the steps a second time; one past the floor does (VIEW-114, FIX-3)", async () => {
  const { FOCUS_FLOOR_MS } = await import("./sidebar");
  let mono = 50_000;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => mono);
  try {
    const app = await mount();
    expect(reads()).toBe(1);
    mono += 500;
    win.dispatchEvent(new Event("focus"));
    await app.settle();
    expect(reads()).toBe(1);
    mono += FOCUS_FLOOR_MS;
    win.dispatchEvent(new Event("focus"));
    await app.settle();
    expect(reads()).toBe(2);
  } finally {
    spy.mockRestore();
  }
});

test("a read caused by the guide switching on resets the focus floor, so a focus soon after does not read again (VIEW-114, FIX-4)", async () => {
  const { CHECKLIST_CHANGED } = await import("./firstRun");
  let mono = 50_000;
  const spy = vi.spyOn(performance, "now").mockImplementation(() => mono);
  try {
    // The first-run wizard is still open: the guide is not wanted, so nothing is read at mount.
    record = { tipsSeen: [], visited: [], tried: [], toursSeen: [], toursAuto: null, firstRun: { closed: false, outcome: null, checklistDismissed: false, milestones: {} } };
    const app = await mount();
    expect(reads()).toBe(0);
    // 25 s later the wizard closes; the slot now wants the guide and reads once (that read is at 75 s).
    mono += 25_000;
    record = { tipsSeen: [], visited: [], tried: [], toursSeen: [], toursAuto: null, firstRun: { closed: true, outcome: "dismissed", checklistDismissed: true, milestones: {} } };
    win.dispatchEvent(new Event(CHECKLIST_CHANGED));
    await app.settle();
    expect(reads()).toBe(1);
    // 10 s after that read, a focus is well inside the 30 s floor: no second read.
    mono += 10_000;
    win.dispatchEvent(new Event("focus"));
    await app.settle();
    expect(reads()).toBe(1);
  } finally {
    spy.mockRestore();
  }
});

test("Hide from sidebar saves the choice and the entry goes (ONB-020)", async () => {
  const app = await mount();
  const root = app.out() as { props: { className: string; children: { props: { title?: string; onClick?: () => void } }[] } };
  expect(root.props.className).toBe("onb-entry");
  const hide = root.props.children.find((c) => c?.props?.title === "Hide from sidebar");
  expect(hide).toBeTruthy();
  hide!.props.onClick!();
  await app.settle();
  expect(calls).toContain("settings_patch");
  expect(app.out()).toBeNull();
});

type Entry = { props: { className: string; children: { type?: string; props?: { title?: string; role?: string; children?: unknown; onClick?: () => void } }[] } };
const hideButton = (out: unknown) => (out as Entry).props.children.find((c) => c?.props?.title === "Hide from sidebar")!;

test("Hide goes through the settings save in turn: it reads what is saved, then writes only the changed key (FIX-1)", async () => {
  const app = await mount();
  hideButton(app.out()).props!.onClick!();
  await app.settle();
  expect(patches).toEqual([{ set: { setupChecklistHidden: true }, remove: [] }]);
  expect(calls[calls.indexOf("settings_patch") - 1]).toBe("get_settings");
});

test("a Hide that could not be saved brings the entry back with a short message (FIX-1)", async () => {
  patchFails = true;
  const app = await mount();
  hideButton(app.out()).props!.onClick!();
  await app.settle();
  const out = app.out() as Entry;
  expect(out?.props.className).toBe("onb-entry");
  const note = out.props.children.find((c) => c?.props?.role === "status");
  expect(String(note?.props?.children)).toMatch(/could not be hidden/);
  // trying again once the save works hides it
  patchFails = false;
  hideButton(app.out()).props!.onClick!();
  await app.settle();
  expect(app.out()).toBeNull();
});
