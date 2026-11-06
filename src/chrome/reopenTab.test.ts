// T-164-b / TERM-047: closing three tabs and reopening three times brings all three back newest first;
// only the ten newest are kept; a vanished folder is remapped; browser pages and terminal tabs undo in
// the order they were closed. The window's real "does this folder exist" answer is path_kind, faked here.
import { expect, test, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import type { Pane } from "../App";
import { closedRecord, createClosedPanes, folderKind, paneFor, placement } from "./reopenTab";

const pane = (key: number, cwd: string | null = "G:\\Dev\\x", extra: Partial<Pane> = {}): Pane => ({ key, cwd, branch: null, agent: "shell", program: null, args: [], ...extra });
const dirs = (...ok: string[]) => async (p: string) => (ok.includes(p) ? "dir" : "missing");
const never = () => false;

test("closing three tabs and reopening three times brings all three back in reverse order", async () => {
  const c = createClosedPanes();
  const ps = [pane(1), pane(2), pane(3)];
  c.remember(ps, [1, 2, 3], never);
  const back: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await c.take(dirs("G:\\Dev\\x"), null);
    back.push(r.kind === "terminal" ? String(r.pane.cwd) : r.kind);
  }
  expect(back).toEqual(["G:\\Dev\\x", "G:\\Dev\\x", "G:\\Dev\\x", "none"]);
  const c2 = createClosedPanes();
  c2.remember([pane(1, "G:\\a", { title: "one" }), pane(2, "G:\\a", { title: "two" }), pane(3, "G:\\a", { title: "three" })], [1, 2, 3], never);
  const titles: (string | undefined)[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await c2.take(dirs("G:\\a"), null);
    titles.push(r.kind === "terminal" ? r.pane.title : undefined);
  }
  expect(titles).toEqual(["three", "two", "one"]);
});

test("after closing 11 tabs, reopen brings back at most the 10 most recent", async () => {
  const c = createClosedPanes();
  const ps = Array.from({ length: 11 }, (_, i) => pane(i + 1, "G:\\a", { title: `t${i + 1}` }));
  c.remember(ps, ps.map((p) => p.key), never);
  expect(c.size()).toBe(10);
  const got: string[] = [];
  for (;;) {
    const r = await c.take(dirs("G:\\a"), null);
    if (r.kind !== "terminal") break;
    got.push(r.pane.title ?? "");
  }
  expect(got).toHaveLength(10);
  expect(got[0]).toBe("t11");
  expect(got[9]).toBe("t2");
});

test("a folder whose spelling is gone comes back in a spelling that exists, else in the home folder", async () => {
  const c = createClosedPanes();
  c.remember([pane(1, "G:\\Dev\\x"), pane(2, "Z:\\gone")], [1, 2], never);
  const gone = await c.take(dirs("G:\\Dev\\x"), "G:\\home");
  expect(gone.kind === "terminal" && gone.pane.cwd).toBe("G:\\home");
  const other = await c.take(dirs("/g/Dev/x"), "G:\\home");
  expect(other.kind === "terminal" && other.pane.cwd).toBe("/g/Dev/x");
});

test("with no home and no folder left the tab comes back without a workspace", async () => {
  const c = createClosedPanes();
  c.remember([pane(1, "Z:\\gone")], [1], never);
  const r = await c.take(dirs(), null);
  expect(r.kind === "terminal" && paneFor(r.pane, 9).cwd).toBeNull();
});

test("a pane that had no workspace stays without one, whatever the home is", async () => {
  const c = createClosedPanes();
  c.remember([pane(1, null, { title: "loose" })], [1], never);
  const r = await c.take(dirs(), "G:\\home");
  expect(r.kind).toBe("terminal");
  expect(r.kind === "terminal" && paneFor(r.pane, 9)).toMatchObject({ key: 9, cwd: null, title: "loose" });
});

test("a failing folder check counts as a missing folder", async () => {
  const c = createClosedPanes();
  c.remember([pane(1, "G:\\a")], [1], never);
  const r = await c.take(() => Promise.reject(new Error("no")), "G:\\home");
  expect(r.kind === "terminal" && r.pane.cwd).toBe("G:\\home");
});

test("browser pages and terminal tabs undo in the order they were closed", async () => {
  const c = createClosedPanes();
  const ps = [pane(1, "G:\\a", { title: "term" }), pane(2, "G:\\a", { kind: "browser", url: "https://x.test/" }), pane(3, "G:\\a", { title: "term2" })];
  c.remember(ps, [1], never);
  c.remember(ps, [2], (k) => k === 2); // the browser lane kept this page
  c.remember(ps, [3], never);
  const kinds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await c.take(dirs("G:\\a"), null);
    kinds.push(r.kind === "terminal" ? `terminal:${r.pane.title}` : r.kind);
  }
  expect(kinds).toEqual(["terminal:term2", "browser", "terminal:term", "none"]);
});

test("a browser page the browser lane did not keep leaves no mark, and other kinds are not remembered", () => {
  const c = createClosedPanes();
  const ps = [pane(1, "G:\\a", { kind: "browser" }), pane(2, "G:\\a", { kind: "editor", path: "x" }), pane(3, "G:\\a", { seats: [] })];
  c.remember(ps, [1, 2, 3], never);
  expect(c.size()).toBe(0);
  expect(closedRecord(ps[0])).toBeNull();
});

test("what a reopened tab runs is kept, what only belonged to the old session is not", () => {
  const rec = closedRecord(pane(5, "G:\\a", { agentId: "claude", program: "claude", args: ["--x"], env: [["A", "b"]], title: "T", word: "claude", session: "s1", resumed: true, typed: "go", ask: "q", group: 4 }));
  expect(rec).toMatchObject({ cwd: "G:\\a", agentId: "claude", program: "claude", args: ["--x"], env: [["A", "b"]], title: "T", word: "claude" });
  const back = paneFor(rec!, 12, 7);
  expect(back).toMatchObject({ key: 12, group: 7, agentId: "claude" });
  expect(back.session).toBeUndefined();
  expect(back.typed).toBeUndefined();
  expect(back.ask).toBeUndefined();
});

test("the tab returns to the focused cell when it is in the same folder, else to a cell of its own", () => {
  const ps = [pane(1, "G:\\a"), pane(2, "G:\\a", { group: 1 }), pane(3, "G:\\b")];
  expect(placement(ps, 2, "G:\\a")).toBe(1);
  expect(placement(ps, 3, "G:\\a")).toBeUndefined();
  expect(placement(ps, 1, "G:\\z")).toBeUndefined();
});

test("a workspace already showing the most cells takes the tab into its first cell", () => {
  const ps = Array.from({ length: 24 }, (_, i) => pane(i + 1, "G:\\a"));
  expect(placement(ps, 99, "G:\\a")).toBe(1);
});

test("after-list 383: the folder check asks path_kind for a folder only, so a folder under no project still counts as there", async () => {
  invoke.mockImplementation(async (_cmd: string, a: { path: string }) => (a.path === "D:/loose" ? "dir" : "missing"));
  const c = createClosedPanes();
  c.remember([pane(1, "D:/loose")], [1], never);
  const r = await c.take(folderKind, "G:/home");
  expect(invoke).toHaveBeenCalledWith("path_kind", { path: "D:/loose", folderOnly: true });
  expect(r.kind === "terminal" && r.pane.cwd).toBe("D:/loose");
});
