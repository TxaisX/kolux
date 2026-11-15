// Job 13 F3: a Start across several folders closes only the form that started it. The second folder and later land
// without changing the screen, the page, the folder in front or the focus, so what the user opened meanwhile stays.
// Terminal-only seats: nothing is asked of the back end, so the real startSeats runs with plain stand-ins.
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject("not stubbed") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const { launchActions } = await import("./launchActions");
const { TERMINAL } = await import("./seats");

const seat = () => ({ agent: TERMINAL, model: null });
const projects = [
  { id: "a", name: "alpha", path: "C:\alpha" },
  { id: "b", name: "beta", path: "C:\beta" },
];

async function run() {
  type Sheet = { key: number } | null;
  const state: { sheet: Sheet } = { sheet: null };
  const form = { key: 50, cwd: "C:\alpha", branch: null, agent: "shell", program: null, args: [], seats: [seat()], folders: ["a", "b"] };
  state.sheet = form;
  const setSheet = vi.fn((v: Sheet | ((s: Sheet) => Sheet)) => void (state.sheet = typeof v === "function" ? v(state.sheet) : v));
  let landings = 0;
  // the user opens a new Start form as soon as the first folder has landed
  const setToast = vi.fn(() => void (++landings === 1 && (state.sheet = { key: 77 })));
  const calls = { setFocused: vi.fn(), setActiveDir: vi.fn(), setScreen: vi.fn(), setPage: vi.fn(), setNotice: vi.fn() };
  const s = {
    activeDir: "C:\alpha", agents: [], defaultId: null, focused: 1, nextKey: { current: 100 }, panes: [], projects, sheet: form, settings: {},
    setAgentSel: vi.fn(), setLaunching: vi.fn(), setPanes: vi.fn(), setRefresh: vi.fn(), setSettings: vi.fn(), setSheet, setTabColors: vi.fn(),
    setToast, ...calls,
  };
  const late = { projectOf: (cwd: string | null) => projects.find((p) => p.path === cwd)?.id ?? null, pendingLineup: { current: {} }, panesRef: { current: [] } };
  const saved: number[] = []; // landings seen when the last Start is saved
  const saveSetting = vi.fn(() => void saved.push(landings));
  const a = launchActions(s as never, { settingsRef: { current: {} }, saveSetting } as never, late as never);
  await a.startAcross(form as never, [seat()] as never);
  return { state, calls, landings, saved, saveSetting };
}

test("F3: two folders; a new form opened after the first one lands stays open, and the view is not moved again", async () => {
  const { state, calls, landings } = await run();
  expect(landings).toBe(2);
  expect(state.sheet).toEqual({ key: 77 });
  expect(calls.setScreen).toHaveBeenCalledTimes(1);
  expect(calls.setPage).toHaveBeenCalledTimes(1);
  expect(calls.setActiveDir).toHaveBeenCalledTimes(1);
  expect(calls.setFocused).toHaveBeenCalledTimes(1);
  // every folder started: no "x of y" line
  expect(calls.setNotice).toHaveBeenLastCalledWith(null);
});

test("F8: the last Start is saved once, after the first folder has started, not before", async () => {
  const { saved, saveSetting } = await run();
  expect(saveSetting).toHaveBeenCalledTimes(1);
  expect(saveSetting).toHaveBeenCalledWith("lastStart", { folders: ["a", "b"], count: 1 });
  expect(saved[0]).toBeGreaterThanOrEqual(1);
});
