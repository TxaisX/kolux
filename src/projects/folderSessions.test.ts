// Txais (2026-11-12): a folder's sessions are the open panes in it or in any worktree of it.
import { expect, test, vi } from "vitest";
import { focusPane, sessionDir, sessionLabel, sessionsByProject } from "./folderSessions";

const s = (key: number, cwd: string | null, view?: string | null) => ({ key, agent: "claude", title: `t${key}`, cwd, ...(view !== undefined ? { view } : {}), running: true });
const roots = [
  { id: "a", paths: ["C:/w/app", "C:/w/ws/a1", "C:/w/ws/a2"] },
  { id: "b", paths: ["C:/w/other"] },
];

test("sessions in the folder and in any of its worktrees belong to the project, in pane order", () => {
  const out = sessionsByProject([s(1, "C:/w/app"), s(2, "C:/w/ws/a1", "C:/w/app"), s(3, "C:/W/ws/a2/"), s(4, "C:/w/other/sub")], roots);
  expect(out.a.map((x) => x.key)).toEqual([1, 2, 3]);
  expect(out.b.map((x) => x.key)).toEqual([4]);
});

test("a pane with no folder, or in none of the projects, is listed nowhere; the view is the fallback", () => {
  const out = sessionsByProject([s(1, null), s(2, "D:/elsewhere"), s(3, null, "C:/w/app")], roots);
  expect(out.a.map((x) => x.key)).toEqual([3]);
  expect(out.b).toBeUndefined();
});

test("a project nested inside another keeps its own sessions (the deepest folder wins)", () => {
  const nested = [{ id: "outer", paths: ["C:/w"] }, { id: "inner", paths: ["C:/w/app"] }];
  expect(sessionsByProject([s(1, "C:/w/app/x"), s(2, "C:/w/lib")], nested)).toEqual({ inner: [s(1, "C:/w/app/x")], outer: [s(2, "C:/w/lib")] });
});

test("the row is called by its tab title, else its agent; a click goes to the grid it is shown in", () => {
  expect(sessionLabel({ title: "Fix login", agent: "claude" })).toBe("Fix login");
  expect(sessionLabel({ title: "  ", agent: "codex" })).toBe("codex");
  expect(sessionDir(s(1, "C:/w/ws/a1", "C:/w/app"))).toBe("C:/w/app");
  expect(sessionDir(s(1, "C:/w/ws/a1"))).toBe("C:/w/ws/a1");
});

test("focusPane presses the pane's own header once its grid is drawn, trying again after a wait", () => {
  const pressed = vi.fn();
  const el = { dispatchEvent: pressed };
  let present = false;
  const doc = { querySelector: vi.fn(() => (present ? el : null)) };
  const queue: (() => void)[] = [];
  vi.stubGlobal("MouseEvent", class { constructor(public type: string) {} });
  focusPane(7, doc as never, (fn) => void queue.push(fn));
  queue.shift()!(); // first try: the grid is not drawn yet
  expect(pressed).not.toHaveBeenCalled();
  present = true;
  queue.shift()!(); // the retry
  expect(doc.querySelector).toHaveBeenCalledWith('section.pane[data-key="7"]');
  expect(pressed).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});
