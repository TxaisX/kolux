// DT-C274: an own-folder team (one worktree per AI seat) lands as one grid in the chooser's folder. Each agent runs in
// its own worktree (cwd) and is shown in the chooser's folder (view); the grid limit counts every seat; the team's
// worktrees are recorded so the sidebar leaves them out.
import { beforeEach, expect, test, vi } from "vitest";
import { OWN_FOLDERS_FIELD, setOwnFolders } from "../projects/singleFolder";
import { TEAM_WORKTREES_SETTING } from "../projects/rows";

beforeEach(() => setOwnFolders({ [OWN_FOLDERS_FIELD]: true }));

const h = vi.hoisted(() => ({ made: 0, calls: [] as string[], disk: null as Record<string, unknown> | null, failNotes: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    h.calls.push(cmd);
    if (cmd === "workspace_create_fresh") {
      h.made++;
      return { path: `C:\\r\\wts\\wt${h.made}`, branch: `wt${h.made}` };
    }
    if (cmd === "handoff_note_prepare" && h.failNotes) throw new Error("notes refused");
    if (cmd === "handoff_note_prepare") return `notes/${String(args.name)}.md`;
    if (cmd === "agent_start_line") return { args: [], program: "claude", env: [], typed: null };
    if (cmd === "get_settings") return h.disk;
    return null;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const { launchActions } = await import("./launchActions");

type P = { key: number; cwd: string | null; branch: string | null; agent: string; program: null; args: string[]; seats?: unknown[]; copies?: string };
const shell = (key: number): P => ({ key, cwd: "C:\\r", branch: null, agent: "shell", program: null, args: [] });
const agent = { id: "claude", name: "Claude", program: "claude", args: [], installed: true, path: null };
const seat = { agent: "claude", model: null };

function setup(panes: P[]) {
  const calls = { setPanes: vi.fn(), setFocused: vi.fn(), setNotice: vi.fn(), setActiveDir: vi.fn(), setSettings: vi.fn() };
  const s = {
    activeDir: "C:\\r", agents: [agent], defaultId: null, focused: 50, nextKey: { current: 100 }, panes, projects: [{ id: "p1", path: "C:\\r", name: "r" }], sheet: null, settings: {},
    setAgentSel: vi.fn(), setLaunching: vi.fn(), setPage: vi.fn(), setRefresh: vi.fn(), setScreen: vi.fn(), setSheet: vi.fn(),
    setTabColors: vi.fn(), setToast: vi.fn(), ...calls,
  };
  const settingsRef = { current: {} as Record<string, unknown> };
  const late = { projectOf: () => "p1", pendingLineup: { current: {} }, panesRef: { current: panes }, startSetup: vi.fn() };
  const a = launchActions(s as never, { settingsRef } as never, late as never);
  return { a, settingsRef, ...calls };
}

test("a four-AI own-folder Start lands as one grid in the chooser's folder, each agent in its own worktree", async () => {
  h.made = 0;
  const chooser: P = { ...shell(50), seats: [seat, seat, seat, seat], copies: "separate" };
  const { a, setPanes, setActiveDir, setNotice, settingsRef } = setup([chooser]);
  await a.startSeats(50, [seat, seat, seat, seat] as never);
  expect(setNotice).not.toHaveBeenCalledWith(expect.stringMatching(/holds up to/));
  expect(setPanes).toHaveBeenCalled();
  const next = setPanes.mock.calls[0][0]([chooser]) as { cwd: string; view?: string; title?: string }[];
  expect(next).toHaveLength(4);
  expect(next.map((p) => p.cwd)).toEqual(["C:\\r\\wts\\wt1", "C:\\r\\wts\\wt2", "C:\\r\\wts\\wt3", "C:\\r\\wts\\wt4"]);
  expect(next.every((p) => p.view === "C:\\r")).toBe(true);
  // an untitled seat keeps no custom title (its session name can still show); tabName calls it after its worktree
  expect(next.map((p) => p.title)).toEqual([undefined, undefined, undefined, undefined]);
  expect(setActiveDir).toHaveBeenCalledWith("C:\\r");
  expect(settingsRef.current[TEAM_WORKTREES_SETTING]).toEqual([1, 2, 3, 4].map((i) => ({ path: `C:\\r\\wts\\wt${i}`, view: "C:\\r" })));
});

test("one AI seat in a worktree of its own is no team: its worktree is a workspace of its own, nothing recorded", async () => {
  h.made = 0;
  const chooser: P = { ...shell(50), seats: [seat], copies: "separate" };
  const { a, setPanes, setActiveDir, settingsRef } = setup([chooser]);
  await a.startSeats(50, [seat] as never);
  const next = setPanes.mock.calls[0][0]([chooser]) as { cwd: string; view?: string }[];
  expect(next.map((p) => p.cwd)).toEqual(["C:\\r\\wts\\wt1"]);
  expect(next[0].view).toBeUndefined();
  expect(setActiveDir).toHaveBeenCalledWith("C:\\r\\wts\\wt1");
  expect(settingsRef.current[TEAM_WORKTREES_SETTING]).toBeUndefined();
});

test("the team record is laid over the copy on disk, so another window's team worktrees are kept (Row 794-c)", async () => {
  h.made = 0;
  h.disk = { [TEAM_WORKTREES_SETTING]: [{ path: "D:\\q\\wts\\other", view: "D:\\q" }] };
  try {
    const chooser: P = { ...shell(50), seats: [seat, seat], copies: "separate" };
    const { a, settingsRef } = setup([chooser]);
    await a.startSeats(50, [seat, seat] as never);
    await vi.waitFor(() =>
      expect(settingsRef.current[TEAM_WORKTREES_SETTING]).toEqual([
        { path: "D:\\q\\wts\\other", view: "D:\\q" },
        { path: "C:\\r\\wts\\wt1", view: "C:\\r" },
        { path: "C:\\r\\wts\\wt2", view: "C:\\r" },
      ]),
    );
  } finally {
    h.disk = null;
  }
});

test("a session resumed or opened in a team worktree lands in its team's grid, in a free cell there", async () => {
  const team = { [TEAM_WORKTREES_SETTING]: [{ path: "C:\\r\\wts\\wt1", view: "C:\\r" }] };
  const lead = { ...shell(1), cwd: "C:\\r\\wts\\wt1", view: "C:\\r", branch: "wt1" };
  const empty: P = { ...shell(2), seats: [seat] }; // a chooser not yet started: the free cell of the team's grid
  const plan = { cwd: "C:\\r\\wts\\wt1", line: { args: [], typed: null, program: "claude", env: [], resumed: true }, program: "claude", copy: "" };
  const r = setup([lead, empty]);
  r.settingsRef.current = { ...team };
  await r.a.resumeIn("claude", plan as never, "abc");
  const resumed = r.setPanes.mock.calls[0][0]([lead, empty]) as { key: number; cwd: string; view?: string; branch: string | null }[];
  const pane = resumed.find((p) => p.key >= 100)!;
  expect(pane).toMatchObject({ cwd: "C:\\r\\wts\\wt1", view: "C:\\r", branch: "wt1" });
  expect(resumed.some((p) => p.key === 2)).toBe(false); // it took the empty cell of the team's grid
  expect(r.setActiveDir).toHaveBeenCalledWith("C:\\r");
  // a folder that is no team worktree resumes in its own grid, as before
  const plain = setup([empty]);
  await plain.a.resumeIn("claude", { ...plan, cwd: "C:\\r\\wts\\mine" } as never, "abc");
  expect((plain.setPanes.mock.calls[0][0]([empty]) as { key: number; view?: string }[]).find((p) => p.key >= 100)?.view).toBeUndefined();
  expect(plain.setActiveDir).toHaveBeenCalledWith("C:\\r\\wts\\mine");
  // openIn routes the same way
  const o = setup([lead, empty]);
  o.settingsRef.current = { ...team };
  await o.a.openIn(agent as never, "C:\\r\\wts\\wt1", "wt1", "", true);
  await vi.waitFor(() => expect(o.setActiveDir).toHaveBeenCalledWith("C:\\r"));
  const opened = o.setPanes.mock.calls[o.setPanes.mock.calls.length - 1][0]([lead, empty]) as { key: number; view?: string }[];
  expect(opened.find((p) => p.key >= 100)?.view).toBe("C:\\r");
});

test("the grid limit counts every seat of an own-folder team: 21 cells plus 4 seats is refused before anything is made", async () => {
  h.made = 0;
  h.calls = [];
  const chooser: P = { ...shell(50), seats: [seat, seat, seat, seat], copies: "separate" };
  const { a, setPanes, setNotice } = setup([...Array.from({ length: 21 }, (_, i) => shell(i + 1)), chooser]);
  await a.startSeats(50, [seat, seat, seat, seat] as never);
  expect(setNotice).toHaveBeenCalledWith("A workspace holds up to 24 panes.");
  expect(setPanes).not.toHaveBeenCalled();
  expect(h.calls).not.toContain("workspace_create_fresh");
});

test("panes shown in the chooser's folder count toward its limit: 20 team panes there plus 4 seats fits, 21 does not", async () => {
  const team = (n: number) => Array.from({ length: n }, (_, i): P & { view: string } => ({ ...shell(i + 1), cwd: `C:\\r\\wts\\x${i}`, view: "C:\\r" }));
  const chooser: P = { ...shell(50), seats: [seat, seat, seat, seat], copies: "separate" };
  const fits = setup([...team(20), chooser]);
  await fits.a.startSeats(50, [seat, seat, seat, seat] as never);
  expect(fits.setPanes).toHaveBeenCalled();
  const over = setup([...team(21), chooser]);
  await over.a.startSeats(50, [seat, seat, seat, seat] as never);
  expect(over.setNotice).toHaveBeenCalledWith("A workspace holds up to 24 panes.");
  expect(over.setPanes).not.toHaveBeenCalled();
});

test("each team worktree is recorded as soon as it is made, and stays recorded when the launch then fails", async () => {
  h.made = 0;
  h.failNotes = true;
  try {
    const chooser: P = { ...shell(50), seats: [seat, seat], copies: "separate" };
    const { a, setPanes, settingsRef } = setup([chooser]);
    await a.startSeats(50, [seat, seat] as never);
    expect(setPanes).not.toHaveBeenCalled(); // nothing landed
    expect(settingsRef.current[TEAM_WORKTREES_SETTING]).toEqual([1, 2].map((i) => ({ path: `C:\\r\\wts\\wt${i}`, view: "C:\\r" })));
  } finally {
    h.failNotes = false;
  }
});
