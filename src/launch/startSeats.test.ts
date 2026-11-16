// SESS-008 / SESS-013: a Start from a grid chooser keeps the workspace within MAX_PANES (the cells already there
// count), and a chooser closed while the Start was under way leaves no focus on a pane that is not there.
// Terminal-only seats: nothing is asked of the back end, so the real startSeats runs with plain stand-ins.
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.reject("not stubbed") }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const { launchActions } = await import("./launchActions");
const { TERMINAL } = await import("./seats");

type P = { key: number; cwd: string | null; branch: null; agent: string; program: null; args: string[]; seats?: unknown[]; task?: string; title?: string };
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

// TERM-007 (live check of 2026-11-16): a folder's grid opens with one pane that has not started. A Start from the
// Start form used to add its sessions beside that pane and leave it empty; now they take such panes first.
// The form is not a pane of the grid: it is handed in as `given`, under a key the grid does not hold.
const form = (key: number, n: number): P => ({ ...shell(key), seats: Array.from({ length: n }, seat) });
const landed = (setPanes: ReturnType<typeof vi.fn>, panes: P[]): P[] => (setPanes.mock.calls[0][0] as (ps: P[]) => P[])(panes);
const keys = (ps: P[]) => ps.map((p) => p.key);

test("TERM-007: a Start from the form fills the grid's unstarted pane first and adds the rest after it", async () => {
  const empty: P = { ...shell(2), seats: [seat()] };
  const panes = [shell(1), empty, shell(3)];
  const { a, setPanes, setFocused } = setup(panes);
  await a.startSeats(60, [seat(), seat()] as never, form(60, 2) as never);
  const after = landed(setPanes, panes);
  expect(keys(after)).toEqual([1, 100, 3, 101]);
  expect(after.some((p) => p.seats)).toBe(false);
  expect(setFocused).toHaveBeenCalledWith(100);
});

test("TERM-007: fewer sessions than unstarted panes fill the first ones and leave the rest", async () => {
  const empty = (key: number): P => ({ ...shell(key), seats: [seat()] });
  const panes = [empty(1), shell(2), empty(3)];
  const { a, setPanes } = setup(panes);
  await a.startSeats(60, [seat()] as never, form(60, 1) as never);
  const after = landed(setPanes, panes);
  expect(keys(after)).toEqual([100, 2, 3]);
  expect(after[2].seats).toBeTruthy();
});

test("TERM-007: a pane the form fills is not counted twice against the grid's limit", async () => {
  const panes = [...Array.from({ length: 23 }, (_, i) => shell(i + 1)), { ...shell(24), seats: [seat()] }];
  const one = setup(panes);
  await one.a.startSeats(60, [seat()] as never, form(60, 1) as never);
  expect(keys(landed(one.setPanes, panes))).toEqual([...Array.from({ length: 23 }, (_, i) => i + 1), 100]);
  const two = setup(panes);
  await two.a.startSeats(60, [seat(), seat()] as never, form(60, 2) as never);
  expect(two.setPanes).not.toHaveBeenCalled();
  expect(two.setNotice).toHaveBeenCalledWith("A workspace holds up to 24 panes.");
});

test("TERM-007: an unstarted pane in another folder's grid is not taken", async () => {
  const elsewhere: P = { ...shell(2), cwd: "C:\\other", seats: [seat()] };
  const panes = [shell(1), elsewhere];
  const { a, setPanes } = setup(panes);
  await a.startSeats(60, [seat()] as never, form(60, 1) as never);
  expect(keys(landed(setPanes, panes))).toEqual([1, 2, 100]);
});

test("a Start from a grid chooser still takes only its own place: another unstarted pane is left alone", async () => {
  const chooser: P = { ...shell(50), seats: [seat(), seat()] };
  const other: P = { ...shell(51), seats: [seat()] };
  const panes = [shell(1), chooser, other];
  const { a, setPanes } = setup(panes);
  await a.startSeats(50, [seat(), seat()] as never);
  expect(keys(landed(setPanes, panes))).toEqual([1, 100, 101, 51]);
});

// Review 101, F1: an unstarted pane that holds something the user typed is not empty. The form's Start leaves it
// as it is (its text would be gone without a word) and its sessions land after it.
test("TERM-007: an unstarted pane with a typed task, seat name or prompt is kept; the form's session lands after it", async () => {
  const typed: Partial<P>[] = [{ task: "half typed" }, { seats: [{ ...seat(), title: "Reviewer" }] }, { seats: [{ ...seat(), prompt: "read the tests" }] }, { title: "Mine" }];
  for (const more of typed) {
    const panes: P[] = [shell(1), { ...shell(2), seats: [seat()], ...more }];
    const { a, setPanes } = setup(panes);
    await a.startSeats(60, [seat()] as never, form(60, 1) as never);
    const after = landed(setPanes, panes);
    expect(keys(after)).toEqual([1, 2, 100]);
    expect(after[1]).toBe(panes[1]);
  }
});

test("TERM-007: a pane with typed text is a taken cell for the grid's limit", async () => {
  const panes: P[] = [...Array.from({ length: 23 }, (_, i) => shell(i + 1)), { ...shell(24), seats: [seat()], task: "half typed" }];
  const { a, setPanes, setNotice } = setup(panes);
  await a.startSeats(60, [seat()] as never, form(60, 1) as never);
  expect(setPanes).not.toHaveBeenCalled();
  expect(setNotice).toHaveBeenCalledWith("A workspace holds up to 24 panes.");
});
