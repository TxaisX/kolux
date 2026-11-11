// A Settings page draws at once from the window's copy of the settings, then takes its own read. Tested through the
// real hook with React's hooks swapped for a tiny runtime (the same way onboarding/useWizard.test.ts does it).
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

// The disk, and the page's own first read held back until the test lets it land.
const io = vi.hoisted(() => ({ disk: {} as Record<string, unknown>, firstRead: null as null | ((s: Record<string, unknown>) => void), reads: 0 }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: { set: Record<string, unknown>; remove: string[] }) => {
    if (cmd === "get_settings") {
      io.reads++;
      if (io.reads === 1) return new Promise((r) => (io.firstRead = r));
      return Promise.resolve({ ...io.disk });
    }
    if (cmd === "settings_patch") {
      io.disk = { ...io.disk, ...args!.set };
      for (const k of args!.remove) delete io.disk[k];
      return Promise.resolve();
    }
    return Promise.reject(new Error(`unexpected ${cmd}`));
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

beforeEach(() => {
  h.slots = [];
  h.effects = [];
  io.reads = 0;
  io.firstRead = null;
});
afterEach(async () => (await import("./windowSettings")).holdWindowSettings(null));

async function mount() {
  const { useSettings } = await import("./useSettings");
  let out!: ReturnType<typeof useSettings>;
  const draw = () => {
    do {
      h.dirty = false;
      h.i = 0;
      h.e = 0;
      h.queue = [];
      out = useSettings();
      for (const run of h.queue) run();
    } while (h.dirty);
  };
  const settle = async () => {
    for (let n = 0; n < 10; n++) {
      await new Promise((r) => setTimeout(r, 0));
      if (h.dirty) draw();
    }
  };
  draw();
  return { now: () => out, settle };
}

test("the first render has the window's values; the page's own read replaces them when it lands", async () => {
  (await import("./windowSettings")).holdWindowSettings({ editorAutoSave: true, branchPrefix: "old", xaiApiKey: "secret" });
  io.disk = { editorAutoSave: true, branchPrefix: "new", diffView: "split" };
  const page = await mount();
  expect(page.now().settings).toEqual({ editorAutoSave: true, branchPrefix: "old" }); // drawn at once, no secret
  io.firstRead!({ ...io.disk });
  await page.settle();
  expect(page.now().settings).toEqual({ editorAutoSave: true, branchPrefix: "new", diffView: "split" });
});

test("a save made from the seed before the read lands changes only its own field and survives the late read", async () => {
  (await import("./windowSettings")).holdWindowSettings({ editorAutoSave: false, branchPrefix: "old" });
  io.disk = { editorAutoSave: false, branchPrefix: "new", diffView: "split" };
  const readAtStart = { ...io.disk };
  const page = await mount();
  const saved = page.now().save({ editorAutoSave: true });
  await page.settle();
  expect(await saved).toBe(true);
  expect(io.disk).toEqual({ editorAutoSave: true, branchPrefix: "new", diffView: "split" }); // the seed's stale branchPrefix never written
  io.firstRead!(readAtStart); // the read that started before the save lands last
  await page.settle();
  expect(page.now().settings).toEqual({ editorAutoSave: true, branchPrefix: "new", diffView: "split" });
});

test("before the window has read its settings there is no seed: the page waits for its read as before", async () => {
  const page = await mount();
  expect(page.now().settings).toBeNull();
  io.firstRead!({ a: 1 });
  await page.settle();
  expect(page.now().settings).toEqual({ a: 1 });
});

test("a read that finds what the seed drew keeps the same copy, so the page is not drawn a second time", async () => {
  (await import("./windowSettings")).holdWindowSettings({ editorAutoSave: true, diffView: "split", openIn: [{ id: "code" }] });
  const page = await mount();
  const seeded = page.now().settings;
  io.firstRead!({ openIn: [{ id: "code" }], diffView: "split", editorAutoSave: true }); // same values, another key order
  await page.settle();
  expect(page.now().settings).toBe(seeded);
});

test("sameSettings compares values, not key order or identity", async () => {
  const { sameSettings } = await import("./useSettings");
  expect(sameSettings({ a: 1, b: [1, { c: "x" }] }, { b: [1, { c: "x" }], a: 1 })).toBe(true);
  expect(sameSettings({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(sameSettings({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  expect(sameSettings({ a: [] }, { a: {} })).toBe(false);
  expect(sameSettings({ a: null }, { a: 0 })).toBe(false);
});
