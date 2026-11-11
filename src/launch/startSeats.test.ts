// SESS-008 / SESS-013: a Start from a grid chooser keeps the workspace within MAX_PANES (the cells already there
// count), and a chooser closed while the Start was under way leaves no focus on a pane that is not there.
// Terminal-only seats: nothing is asked of the back end, so the real startSeats runs with plain stand-ins.
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject("not stubbed") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const { launchActions } = await import("./launchActions");
const { TERMINAL } = await import("./seats");

type P = { key: number; cwd: string | null; branch: null; agent: string; program: null; args: string[]; seats?: unknown[] };
const shell = (key: number): P => ({ key, cwd: "C:\\w", branch: null, agent: "shell", program: null, args: [] });
const seat = () => ({ agent: TERMINAL, model: null });

function setup(panes: P[], live: P[] = panes) {
  const calls = { setPanes: vi.fn(), setFocused: vi.fn(), setNotice: vi.fn(), setActiveDir: vi.fn() };
  const s = {
    activeDir: "C:\\w", agents: [], defaultId: null, focused: 1, nextKey: { current: 100 }, panes, projects: [], sheet: null, settings: {},
    setAgentSel: vi.fn(), setLaunching: vi.fn(), setPage: vi.fn(), setRefresh: vi.fn(), setScreen: vi.fn(), setSettings: vi.fn(), setSheet: vi.fn(),
    setTabColors: vi.fn(), setToast: vi.fn(), ...calls,
  };
  const late = { projectOf: () => null, pendingLineup: { current: {} }, panesRef: { current: live } };
  const a = launchActions(s as never, { settingsRef: { current: {} } } as never, late as never);
  return { a, ...calls };
}

test("a Start that would take the grid past 24 cells is refused with the grid's own words", async () => {
  const chooser: P = { ...shell(50), seats: [seat(), seat(), seat()] };
  const { a, setPanes, setNotice } = setup([...Array.from({ length: 23 }, (_, i) => shell(i + 1)), chooser]);
  await a.startSeats(50, [seat(), seat(), seat()] as never);
  expect(setPanes).not.toHaveBeenCalled();
  expect(setNotice).toHaveBeenCalledWith("A workspace holds up to 24 panes.");
});

test("a Start that fits (the chooser's own cell gives its place) goes ahead", async () => {
  const chooser: P = { ...shell(50), seats: [seat()] };
  const { a, setPanes } = setup([...Array.from({ length: 23 }, (_, i) => shell(i + 1)), chooser]);
  await a.startSeats(50, [seat()] as never);
  expect(setPanes).toHaveBeenCalled();
});

test("a grid chooser closed during the Start: nothing lands and the focus is left alone", async () => {
  const chooser: P = { ...shell(50), seats: [seat()] };
  const { a, setPanes, setFocused, setActiveDir } = setup([shell(1), chooser], [shell(1)]);
  await a.startSeats(50, [seat()] as never);
  expect(setPanes).not.toHaveBeenCalled();
  expect(setFocused).not.toHaveBeenCalled();
  expect(setActiveDir).not.toHaveBeenCalled();
});
