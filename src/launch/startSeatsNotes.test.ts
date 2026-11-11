// SESS-025: the handoff notes of a Start are asked for together, and each seat still gets its own note in seat order.
import { beforeEach, expect, test, vi } from "vitest";
import { OWN_FOLDERS_FIELD, setOwnFolders } from "../projects/singleFolder";

// DT-C273: own folders are the default now; these tests cover one folder per project.
beforeEach(() => setOwnFolders({ [OWN_FOLDERS_FIELD]: false }));

const h = vi.hoisted(() => ({ asked: [] as string[], open: 0, most: 0, prompts: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "handoff_note_prepare") {
      const name = String(args.name);
      h.asked.push(name);
      h.open++;
      h.most = Math.max(h.most, h.open);
      // the first seat's note comes back last
      await new Promise((r) => setTimeout(r, name.endsWith("seat-1") ? 30 : 5));
      h.open--;
      return `notes/${name}.md`;
    }
    if (cmd === "agent_start_line") {
      h.prompts.push(String(args.prompt));
      return { args: [], program: "claude", env: [], typed: null };
    }
    return null;
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const { launchActions } = await import("./launchActions");

test("two AI seats: both notes are asked at once and each prompt carries its own seat's note", async () => {
  const chooser = { key: 50, cwd: "C:\\w", branch: null, agent: "shell", program: null, args: [], seats: [{}, {}], task: "do the thing" };
  const agent = { id: "claude", name: "Claude", program: "claude", args: [], installed: true, path: null };
  const setPanes = vi.fn();
  const s = {
    activeDir: "C:\\w", agents: [agent], defaultId: null, focused: 50, nextKey: { current: 100 }, panes: [chooser], projects: [], sheet: null, settings: {},
    setAgentSel: vi.fn(), setLaunching: vi.fn(), setPage: vi.fn(), setRefresh: vi.fn(), setScreen: vi.fn(), setSettings: vi.fn(), setSheet: vi.fn(),
    setTabColors: vi.fn(), setToast: vi.fn(), setPanes, setFocused: vi.fn(), setNotice: vi.fn(), setActiveDir: vi.fn(),
  };
  const late = { projectOf: () => null, pendingLineup: { current: {} }, panesRef: { current: [chooser] } };
  const a = launchActions(s as never, { settingsRef: { current: {} } } as never, late as never);
  const seat = { agent: "claude", model: null };
  await a.startSeats(50, [seat, seat] as never);
  expect(h.most).toBe(2);
  expect(h.asked).toEqual(["w-seat-1", "w-seat-2"]);
  expect(h.prompts[0]).toContain("notes/w-seat-1.md");
  expect(h.prompts[1]).toContain("notes/w-seat-2.md");
  expect(setPanes).toHaveBeenCalled();
});
