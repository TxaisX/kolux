import { expect, test } from "vitest";
import { countsAsAgent, inactive, workingByDir, workingWord } from "./working";

const pane = (key: number, cwd: string | null, agent = "claude", extra: Record<string, unknown> = {}) => ({ key, cwd, agent, ...extra });

test("a split tab with an agent in each half counts two working (STAT-036)", () => {
  const panes = [pane(1, "C:/w/a"), pane(2, "C:/w/a"), pane(3, "C:/w/b")];
  const counts = workingByDir(panes, { 1: "working", 2: "working", 3: "done" }, { 1: true, 2: true, 3: true });
  expect(counts).toEqual({ "C:/w/a": 2 });
  expect(workingWord(counts["C:/w/a"])).toBe("2 working");
});

test("with no hook state the live tab is the fallback, and an ended program never counts (STAT-036)", () => {
  const panes = [pane(1, "C:/w/a"), pane(2, "C:/w/a"), pane(3, "C:/w/a")];
  // 1: program up, no hooks; 2: program ended; 3: still starting (not reported yet).
  expect(workingByDir(panes, {}, { 1: true, 2: false })).toEqual({ "C:/w/a": 2 });
});

test("waiting, permission and done agents are not working; shells, editors and kit tabs are not agents (STAT-036)", () => {
  const panes = [pane(1, "C:/w/a"), pane(2, "C:/w/a"), pane(3, "C:/w/a"), pane(4, "C:/w/a", "shell"), pane(5, "C:/w/a", "claude", { kind: "editor" }), pane(6, "C:/w/a", "claude", { seats: [1, 2] }), pane(7, null)];
  const hook = { 1: "waiting", 2: "permission", 3: "working", 4: "working", 5: "working", 6: "working", 7: "working" } as const;
  expect(workingByDir(panes, hook, {})).toEqual({ "C:/w/a": 1 });
  expect(panes.filter(countsAsAgent).map((p) => p.key)).toEqual([1, 2, 3]);
});

test("no count for none, and a sleeping or never-opened workspace is inactive (STAT-036)", () => {
  expect(workingWord(0)).toBe("");
  expect(workingWord(undefined)).toBe("");
  expect(workingWord(1)).toBe("1 working");
  expect(inactive(true, 3)).toBe(true);
  expect(inactive(false, 0)).toBe(true);
  expect(inactive(false, 1)).toBe(false);
});

test("Cursor, MiMo and Pi launched in a workspace count by their launch record and their own titles (SESS-040)", () => {
  const panes = [
    pane(1, "C:/w/a", "shell", { agentId: "cursor", program: "cursor-agent" }),
    pane(2, "C:/w/a", "shell", { agentId: "mimo-code", program: "mimo" }),
    pane(3, "C:/w/b", "shell", { agentId: "pi", program: "pi" }),
    pane(4, "C:/w/b", "shell", { program: null }),
  ];
  const live = { 1: { title: "⠋ Cursor Agent" }, 2: { title: "MiMo Code - done" }, 3: { title: "π ⠹ kolux-rs" }, 4: { title: "⠋ working" } };
  // MiMo's title says it finished; the plain shell (no launch record) is never counted from output.
  expect(workingByDir(panes, {}, { 1: true, 2: true, 3: true, 4: true }, live)).toEqual({ "C:/w/a": 1, "C:/w/b": 1 });
  // A hook's word still wins over the title, and an ended program never counts.
  expect(workingByDir(panes, { 2: "working" }, { 1: false, 2: true, 3: true }, live)).toEqual({ "C:/w/a": 1, "C:/w/b": 1 });
});

test("a title naming another agent is not the launched agent's state: the program-up guess stands (SESS-040)", () => {
  const panes = [pane(1, "C:/w/a", "shell", { agentId: "cursor", program: "cursor-agent" })];
  // Cursor printing "✳ Claude Code" would read as done; it names Claude, so it is ignored and Cursor stays working.
  expect(workingByDir(panes, {}, { 1: true }, { 1: { title: "✳ Claude Code" } })).toEqual({ "C:/w/a": 1 });
  expect(workingByDir(panes, {}, { 1: true }, { 1: { title: "Cursor Agent - done" } })).toEqual({});
});
