import { expect, test } from "vitest";
import { renderToString } from "react-dom/server";
import { cleanupCandidates, EndQuestion, endConfirmed, makeLoadedLatch, ManageSessions, paneless, sessionLabel, sessionsLoaded, type InventoryTab } from "./manage";
import { groupSessions, type SessionUsage } from "./resources";

const s = (id: number): SessionUsage => ({ id, pid: 100 + id, dir: "C:/w/a", bytes: 1, cpu: 0, processes: 1, committed: null, unreadable: 0 });
const none: Record<number, boolean> = {};
const quiet = (...ids: number[]) => Object.fromEntries(ids.map((id) => [id, false]));
const tab = (id: number, agent: string | null): InventoryTab => ({ handle: `term-${id}`, agent });

test("T-153-e: Manage Sessions offers only shells no pane shows", () => {
  const sessions = [s(1), s(2), s(3)];
  const tabs = [tab(1, null), tab(2, null), tab(3, null)];
  const got = cleanupCandidates(sessions, tabs, { 1: "pwsh" }, true, quiet(1, 2, 3));
  expect(got.map((r) => r.id)).toEqual([2, 3]);
  expect(cleanupCandidates(sessions, tabs, { 1: "a", 2: "b", 3: "c" }, true, quiet(1, 2, 3)), "every session in a pane: nothing to clean").toEqual([]);
});

test("T-153-e: an agent-owned session is never offered, even with no pane", () => {
  const sessions = [s(1), s(2), s(3)];
  const tabs = [tab(1, "claude"), tab(2, null), tab(3, "codex")];
  expect(cleanupCandidates(sessions, tabs, {}, true, quiet(1, 2, 3)).map((r) => r.id)).toEqual([2]);
});

test("T-153-e: a session the inventory does not list (or a failed inventory read) is not offered", () => {
  expect(cleanupCandidates([s(1), s(2)], [tab(1, null)], {}, true, quiet(1, 2)).map((r) => r.id)).toEqual([1]);
  expect(cleanupCandidates([s(1), s(2)], null, {}, true, quiet(1, 2))).toEqual([]);
});

test("T-153-e: until the window has loaded its workspaces nothing is offered and nothing reads as attached or loose", () => {
  expect(cleanupCandidates([s(1), s(2)], [tab(1, null), tab(2, null)], {}, false, quiet(1, 2))).toEqual([]);
  expect(sessionLabel(4, { 4: "pwsh" }, false)).toEqual({ name: "Session 4", shown: false });
  expect(sessionLabel(4, {}, false).name).not.toContain("not in a pane");
  expect(sessionLabel(4, { 4: "pwsh" }, true)).toEqual({ name: "pwsh", shown: true });
  expect(sessionLabel(5, {}, true)).toEqual({ name: "Session 5 (not in a pane)", shown: false });
});

test("T-153-e: the Manage Sessions section says what it will end, waits while loading, and asks with Keep focused", () => {
  const two = cleanupCandidates([s(2), s(3)], [tab(2, null), tab(3, null)], {}, true, quiet(2, 3));
  const idle = renderToString(ManageSessions({ loaded: true, candidates: two, asking: false, onAsk: () => {}, onEnd: () => {}, onKeep: () => {} }));
  expect(idle).toContain("2 sessions no pane shows");
  expect(idle).toContain("End 2");
  const ask = renderToString(ManageSessions({ loaded: true, candidates: two, asking: true, onAsk: () => {}, onEnd: () => {}, onKeep: () => {} }));
  expect(ask).toContain("alertdialog");
  expect(ask, "Keep holds focus, so a stray Enter ends nothing (VIEW-116)").toMatch(/<button[^>]*autofocus[^>]*>Keep<\/button>/i);
  expect(ask).toContain("Agent sessions, and shells with a program running");
  const none = renderToString(ManageSessions({ loaded: true, candidates: [], asking: false, onAsk: () => {}, onEnd: () => {}, onKeep: () => {} }));
  expect(none).toContain("Every session is in a pane");
  expect(none).not.toContain("End ");
  const loading = renderToString(ManageSessions({ loaded: false, candidates: [], asking: false, onAsk: () => {}, onEnd: () => {}, onKeep: () => {} }));
  expect(loading).toContain("still loading");
  expect(loading).not.toContain("<button");
});

test("T-153-e: the Resource Manager's rows claim no pane while the window is loading", () => {
  const rows = groupSessions([s(1), s(2)], { 1: "pwsh" }, ["C:/w/a"], false).flatMap((g) => g.rows);
  expect(rows.map((r) => [r.name, r.shown])).toEqual([["Session 1", false], ["Session 2", false]]);
  const after = groupSessions([s(1), s(2)], { 1: "pwsh" }, ["C:/w/a"]).flatMap((g) => g.rows);
  expect(after.map((r) => [r.name, r.shown])).toEqual([["pwsh", true], ["Session 2 (not in a pane)", false]]);
});

// FIX-2 (council re-review of b67efb1): FB-1 and FIX-SOON 1, 2 and 4, AFTER 3.

test("FIX-2: a Resource Manager that is never told the window has loaded counts it as still loading", () => {
  expect(sessionsLoaded(undefined)).toBe(false);
  expect(sessionsLoaded(() => false)).toBe(false);
  expect(sessionsLoaded(() => true)).toBe(true);
});

test("FIX-2: the window has loaded once settings are read and every restored terminal pane has its session or is gone, and it stays loaded", () => {
  const loaded = makeLoadedLatch();
  const panes = [{ key: 1 }, { key: 2 }, { key: 3, kind: "editor" as const }];
  expect(loaded(false, [1, 2, 3], { 1: 7, 2: 8 }, panes), "settings not read yet").toBe(false);
  expect(loaded(true, [1, 2, 3], { 1: 7 }, panes), "restored pane 2 has no session yet").toBe(false);
  expect(loaded(true, [1, 2, 3], { 1: 7 }, [{ key: 1 }, { key: 3, kind: "editor" as const }]), "pane 2 is gone, an editor needs no session").toBe(true);
  expect(loaded(true, [1, 2, 3], { 1: 7 }, [...panes, { key: 9 }]), "latched: a new pane opening later does not undo it").toBe(true);
  expect(makeLoadedLatch()(true, [], {}, []), "nothing to restore: loaded once settings are read").toBe(true);
});

test("FIX-2: End N ends only the sessions the user was asked about that are still offered", async () => {
  const killed: number[] = [];
  const ended = await endConfirmed([2, 3], async () => [s(3), s(4)], async (id) => void killed.push(id));
  expect(ended).toEqual([3]);
  expect(killed, "session 4 appeared after the question and session 2 has gone: neither is touched").toEqual([3]);
  const none2: number[] = [];
  expect(await endConfirmed([5], async () => { throw new Error("read failed"); }, async (id) => void none2.push(id))).toEqual([]);
  expect(none2, "a failed fresh read ends nothing").toEqual([]);
});

test("FIX-2: a shell with a program running in it (an agent typed by hand among them) is never offered", () => {
  const sessions = [s(1), s(2), s(3)];
  const tabs = [tab(1, null), tab(2, null), tab(3, null)];
  expect(cleanupCandidates(sessions, tabs, {}, true, { 1: true, 2: false }).map((r) => r.id), "1 runs claude typed by hand; 3 was not checked").toEqual([2]);
  expect(cleanupCandidates(sessions, tabs, {}, true, null), "the busy check failed: nothing is offered").toEqual([]);
  expect(cleanupCandidates(sessions, tabs, {}, true, none)).toEqual([]);
  expect(paneless(sessions, tabs, { 3: "pwsh" }, true).map((r) => r.id), "the sessions whose busy state is asked for").toEqual([1, 2]);
});

test("FIX-2: both End questions put focus on Keep, never on the button that ends", () => {
  const two = cleanupCandidates([s(2), s(3)], [tab(2, null), tab(3, null)], {}, true, quiet(2, 3));
  const ask = renderToString(ManageSessions({ loaded: true, candidates: two, asking: true, onAsk: () => {}, onEnd: () => {}, onKeep: () => {} }));
  expect(ask).toMatch(/<button[^>]*autofocus[^>]*>Keep<\/button>/i);
  expect(ask).not.toMatch(/<button[^>]*autofocus[^>]*>End 2 sessions<\/button>/i);
  expect(ask).toContain("shells with a program running");
  const row = renderToString(EndQuestion({ name: "Session 4", shown: false, onEnd: () => {}, onKeep: () => {} }));
  expect(row).toMatch(/<button[^>]*autofocus[^>]*>Keep<\/button>/i);
  expect(row).not.toMatch(/<button[^>]*autofocus[^>]*>End session<\/button>/i);
});
