import { expect, test } from "vitest";
import { ago, filterSessions, groupSessions, isEmpty, MAX_QUERY, parseQuery, projectOf, shortLabel, sortSessions, type Session } from "./model";
import { chooseScope, DEFAULT_VIEW, differing, effectiveScope, readScope, readView } from "./prefs";
import { syncedScreen } from "./windowSync";

const s = (over: Partial<Session> = {}): Session => ({ agent: "claude", id: "a", title: "Fix login", modifiedMs: 1000, bytes: 1, turns: 2, dir: "C:/Dev/kolux", ...over });
const projects = [{ path: "C:/Dev/kolux" }, { path: "C:/Dev/other" }];

test("VIEW-081: repo:kolux fix returns only that repo's sessions that mention fix", () => {
  const list = [s(), s({ id: "b", title: "Fix tests", dir: "C:/Dev/other/wt-1" }), s({ id: "c", title: "Add feature", dir: "C:/Dev/kolux/wt-2" }), s({ id: "d", title: "Fix css", dir: "C:/Dev/kolux/wt-2" })];
  const got = filterSessions(list, { query: "repo:kolux fix", hiddenAgents: [], hideEmpty: false }, projects);
  expect(got.map((x) => x.id)).toEqual(["a", "d"]);
});

test("VIEW-081: a quoted phrase must appear whole; path: matches a folder fragment", () => {
  const list = [s({ title: "fix the login page" }), s({ id: "b", title: "login fix the page", dir: "C:/Dev/other" })];
  expect(filterSessions(list, { query: '"fix the login"', hiddenAgents: [], hideEmpty: false }, projects).map((x) => x.id)).toEqual(["a"]);
  expect(filterSessions(list, { query: "path:Dev\\other", hiddenAgents: [], hideEmpty: false }, projects).map((x) => x.id)).toEqual(["b"]);
});

test("VIEW-081: an oversized pasted search gives no results at once", () => {
  const q = "x".repeat(MAX_QUERY + 1);
  expect(parseQuery(q).tooLong).toBe(true);
  expect(filterSessions([s({ title: q })], { query: q, hiddenAgents: [], hideEmpty: false }, projects)).toEqual([]);
  expect(parseQuery("x".repeat(MAX_QUERY)).tooLong).toBe(false);
});

test("VIEW-081: text compares the same however accents were encoded", () => {
  const composed = "caf\u00e9";
  const decomposed = "cafe\u0301";
  expect(filterSessions([s({ title: decomposed })], { query: composed, hiddenAgents: [], hideEmpty: false }, projects)).toHaveLength(1);
});

test("VIEW-081: hidden agents and empty sessions are filtered; a titled session with no turns is not empty", () => {
  const list = [s(), s({ id: "b", agent: "codex" }), s({ id: "c", title: "", turns: 0 }), s({ id: "d", title: "Kept", turns: 0 })];
  expect(isEmpty(list[2])).toBe(true);
  expect(isEmpty(list[3])).toBe(false);
  expect(filterSessions(list, { query: "", hiddenAgents: ["codex"], hideEmpty: true }, projects).map((x) => x.id)).toEqual(["a", "d"]);
});

test("VIEW-081: sorted newest, oldest or by title", () => {
  const list = [s({ id: "a", title: "b", modifiedMs: 1 }), s({ id: "b", title: "a", modifiedMs: 3 }), s({ id: "c", title: "c", modifiedMs: 2 })];
  expect(sortSessions(list, "recent").map((x) => x.id)).toEqual(["b", "c", "a"]);
  expect(sortSessions(list, "oldest").map((x) => x.id)).toEqual(["a", "c", "b"]);
  expect(sortSessions(list, "title").map((x) => x.id)).toEqual(["b", "a", "c"]);
});

test("VIEW-081: groups by agent, folder or project, newest group first, labelled by the last two folder names", () => {
  const list = [s({ id: "a", modifiedMs: 1, dir: "C:/Dev/kolux/wt-1" }), s({ id: "b", modifiedMs: 9, dir: "C:/Dev/other/wt-2", agent: "codex" }), s({ id: "c", modifiedMs: 5, dir: "C:/Dev/kolux/wt-2" })];
  expect(groupSessions(list, "none", projects)).toHaveLength(1);
  expect(groupSessions(list, "agent", projects).map((g) => g.label)).toEqual(["codex", "claude"]);
  const byProject = groupSessions(list, "project", projects);
  expect(byProject.map((g) => g.sessions.length)).toEqual([1, 2]);
  expect(byProject[0].label).toBe("Dev/other");
  expect(groupSessions(list, "folder", projects)).toHaveLength(3);
  expect(shortLabel("C:\\Dev\\kolux\\wt-1")).toBe("kolux/wt-1");
  expect(shortLabel(null)).toBe("Unknown folder");
});

test("VIEW-081: a project is the deepest root a folder is under; a blank root matches nothing", () => {
  expect(projectOf("C:/Dev/kolux/wt-1", [{ path: "C:/Dev" }, { path: "C:/Dev/kolux" }])).toBe("c:/dev/kolux");
  expect(projectOf("C:/Dev/x", [{ path: "" }, { path: "   " }])).toBe("c:/dev/x");
  expect(projectOf(null, projects)).toBeNull();
});

test("VIEW-080: ages read in minutes, hours and days", () => {
  expect(ago(0, 30_000)).toBe("just now");
  expect(ago(0, 120_000)).toBe("2 min ago");
  expect(ago(0, 7_200_000)).toBe("2 h ago");
  expect(ago(0, 172_800_000)).toBe("2 d ago");
});

test("VIEW-082: a saved grouping survives a restart; each bad option falls back alone; the counter counts differences", () => {
  expect(readView(undefined)).toEqual(DEFAULT_VIEW);
  const saved = JSON.parse(JSON.stringify({ ...DEFAULT_VIEW, group: "folder", depth: null, hiddenAgents: ["codex"] }));
  const back = readView(saved);
  expect(back).toMatchObject({ group: "folder", depth: null, hiddenAgents: ["codex"], sort: "recent" });
  expect(differing(back)).toBe(3);
  expect(readView({ group: "weird", sort: "title", depth: -4 })).toMatchObject({ group: "none", sort: "title", depth: 200 });
});

test("VIEW-082: Reset (the defaults) clears the counter", () => {
  expect(differing(readView({ ...DEFAULT_VIEW, hideEmpty: true, sort: "oldest" }))).toBe(2);
  expect(differing(DEFAULT_VIEW)).toBe(0);
});

test("VIEW-080: workspace is the default; an unavailable scope widens and returns; a manual all stays all", () => {
  expect(readScope(undefined)).toEqual({ scope: "workspace", manual: false });
  expect(effectiveScope(readScope(undefined), { workspace: false, project: false })).toBe("all");
  expect(effectiveScope({ scope: "workspace", manual: false }, { workspace: true, project: true })).toBe("workspace");
  expect(effectiveScope({ scope: "project", manual: true }, { workspace: true, project: false })).toBe("all");
  expect(effectiveScope({ scope: "project", manual: true }, { workspace: true, project: true })).toBe("project");
  const all = chooseScope("all");
  expect(all).toEqual({ scope: "all", manual: true });
  // switching worktrees changes what is available, never the saved choice
  expect(effectiveScope(all, { workspace: false, project: false })).toBe("all");
  expect(effectiveScope(all, { workspace: true, project: true })).toBe("all");
  expect(chooseScope("workspace").manual).toBe(false);
});

const valid = ["agents", "terminals", "tower"] as const;

test("VIEW-007: a screen another window just saved moves this window", () => {
  expect(syncedScreen("tower", "terminals", "terminals", valid)).toBe("tower");
});

test("VIEW-007: a save that left the screen value unchanged, or an unknown or same screen, moves nothing", () => {
  expect(syncedScreen("tower", "tower", "terminals", valid)).toBeNull();
  expect(syncedScreen("terminals", "tower", "terminals", valid)).toBeNull();
  expect(syncedScreen("nowhere", "tower", "terminals", valid)).toBeNull();
  expect(syncedScreen(undefined, "tower", "terminals", valid)).toBeNull();
});
