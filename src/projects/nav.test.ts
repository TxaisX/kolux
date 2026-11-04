import { expect, test } from "vitest";
import { EMPTY_HISTORY, navTarget, queryWords, scoreText, stepAllowed, travel, visit, type Place } from "./nav";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { RowMark, chipFilter, dirMark, dirMonitoring, paletteAge, paletteRows, repoOptions, withRepos, worktreeItems, type PaletteItem } from "./WorktreePalette";
import type { Project, Worktree } from "./model";

test("next and previous wrap, a number picks a row", () => {
  expect(navTarget(3, 2, { step: 1 })).toBe(0);
  expect(navTarget(3, 0, { step: -1 })).toBe(2);
  expect(navTarget(3, -1, { step: 1 })).toBe(0);
  expect(navTarget(3, -1, { step: -1 })).toBe(2);
  expect(navTarget(3, 0, { index: 2 })).toBe(1);
  expect(navTarget(3, 0, { index: 4 })).toBeNull();
  expect(navTarget(0, -1, { step: 1 })).toBeNull();
});

const a: Place = { dir: "C:/a", page: null };
const b: Place = { dir: "C:/b", page: null };
const c: Place = { dir: "C:/c", page: null };

test("history keeps a place once at its newest visit and drops what was ahead", () => {
  let h = [a, b, c].reduce(visit, EMPTY_HISTORY);
  expect(visit(h, { dir: "c:/C/", page: null })).toBe(h);
  h = visit(h, a);
  expect(h.list).toEqual([b, c, a]);
  h = { ...h, at: 0 };
  h = visit(h, c);
  expect(h.list).toEqual([b, c]);
  expect(h.at).toBe(1);
});

test("back and forward skip places that are gone", () => {
  const h = { list: [a, b, c], at: 2 };
  expect(travel(h, -1, (p) => p !== b)).toBe(0);
  expect(travel(h, -1, () => false)).toBeNull();
  expect(travel({ ...h, at: 0 }, 1, (p) => p === c)).toBe(2);
  expect(travel(h, 1, () => true)).toBeNull();
});

test("every word has to match, and matches merge", () => {
  const s = (text: string, q: string) => scoreText(text, text.length, queryWords(q))?.spans ?? null;
  expect(s("Fix login page", "LOG  page")).toEqual([[4, 7], [10, 14]]);
  expect(s("Fix login page", "log zebra")).toBeNull();
  expect(s("aaaa", "aa aaa")).toEqual([[0, 3]]);
  expect(s("anything", "")).toEqual([]);
});

test("VIEW-038: exact before prefix before inner or forgiven matches; filler words are dropped", () => {
  const tier = (text: string, q: string) => scoreText(text, text.length, queryWords(q))?.tier ?? null;
  expect(tier("login page", "login")).toBeGreaterThan(tier("logins", "login")!);
  expect(tier("logins", "login")).toBeGreaterThan(tier("relogin", "login")!);
  expect(queryWords("go to Login")).toEqual(["login"]);
  expect(queryWords("open"), "a query of filler alone still searches").toEqual(["open"]);
  expect(tier("fix login", "login nothing")).toBeNull();
  // a single Latin letter: start of a word or a whole word only
  expect(tier("hello world", "l")).toBeNull();
  expect(tier("hello login", "l")).not.toBeNull();
  // small typos only in long words of letters
  expect(tier("login page", "logon")).not.toBeNull();
  expect(tier("fix page", "fx")).toBeNull();
  // accents, full-width forms and CJK fold
  expect(tier("Café menu", "cafe")).not.toBeNull();
  expect(tier("app", "ａｐｐ")).not.toBeNull();
  expect(tier("日本語のテスト", "日本")).not.toBeNull();
});

test("VIEW-038: a number matches only that exact number, with or without #", () => {
  const hit = (text: string, q: string) => scoreText(text, text.length, queryWords(q)) !== null;
  expect(hit("fix-login · #34", "34")).toBe(true);
  expect(hit("fix-login · #34", "#34")).toBe(true);
  expect(hit("other · #340", "34")).toBe(false);
  expect(hit("other · #134", "#34")).toBe(false);
  expect(hit("release v2", "v2")).toBe(true);
  expect(hit("release v20", "v2")).toBe(false);
});

const proj: Project = { id: "p1", name: "app", path: "C:/src/app" };
const ws: Worktree[] = [
  { path: "C:/src/app", branch: "main", head: "1", isMain: true },
  { path: "C:/ws/app/login", branch: "fix-login", head: "2", isMain: false },
  { path: "C:/ws/app/old", branch: "old-thing", head: "3", isMain: false, hidden: true },
];

test("hidden worktrees show only once something is typed; pull requests get their own rows", () => {
  const pr = (d: string) => (d.endsWith("login") ? "open" : null);
  const quiet = worktreeItems([proj], { p1: ws }, false, pr, () => {});
  expect(quiet.filter((i) => i.section === "Workspaces").map((i) => [i.hint, i.parent])).toEqual([["main", "app"], ["fix-login", "app"]]);
  expect(quiet.filter((i) => i.section === "Pull requests").map((i) => i.label)).toEqual(["fix-login"]);
  const typed = worktreeItems([proj], { p1: ws }, true, pr, () => {});
  expect(paletteRows(typed, "old").map((r) => r.section)).toEqual(["Workspaces"]);
});

test("rows come out in section order", () => {
  const it = (section: string, label: string): PaletteItem => ({ section, label, run: () => {} });
  const rows = paletteRows([it("Settings", "Terminal"), it("Open tabs", "terminal 1"), it("Quick actions", "New terminal")], "term");
  expect(rows.map((r) => r.section)).toEqual(["Open tabs", "Settings", "Quick actions"]);
});

test("with no query, unnamed sections (Commands, Accounts) come after the named ones, so Enter never runs Go to File", () => {
  const it = (section: string, label: string): PaletteItem => ({ section, label, run: () => {} });
  const rows = paletteRows([it("Commands", "Go to File"), it("Accounts", "Switch Claude to work"), it("Open tabs", "terminal 1"), it("Quick actions", "New session")], "");
  expect(rows.map((r) => r.section)).toEqual(["Open tabs", "Quick actions", "Commands", "Accounts"]);
});

test("palette rows carry the agent's mark, permission over unread over a fresh finish (VIEW-040)", () => {
  expect(dirMark("permission", true)).toBe("permission");
  expect(dirMark("waiting", true)).toBe("permission");
  expect(dirMark("working", false)).toBe("working");
  expect(dirMark("done", true)).toBe("unread");
  expect(dirMark("done", false)).toBe("done");
  expect(dirMark("idle", false)).toBeNull();
  expect(dirMark(null, true)).toBe("unread");
  // DT-C52: a blocked or interrupted workspace shows Stopped, as its tab does; a question wins, unread output beats a stop.
  expect(dirMark("blocked", false)).toBe("stopped");
  expect(dirMark("interrupted", false)).toBe("stopped");
  expect(dirMark("blocked", true)).toBe("unread");
  const at = (d: string) => (d.endsWith("login") ? { mark: "permission" as const, since: 5 } : null);
  const items = worktreeItems([proj], { p1: ws }, false, () => null, () => {}, at);
  expect(items.filter((i) => i.section === "Workspaces").map((i) => i.mark ?? null)).toEqual([null, "permission"]);
  const html = renderToStaticMarkup(createElement(RowMark, { mark: "permission", since: 1, now: 1 + 50 * 60_000 }));
  expect(html).toContain('aria-label="needs permission"');
  expect(html).toContain(">50m<");
  expect(renderToStaticMarkup(createElement(RowMark, { mark: "unread", since: 0, now: 0 }))).toContain('aria-label="unread"');
  expect(renderToStaticMarkup(createElement(RowMark, { mark: null, since: 0, now: 0 }))).toBe("");
});

test("a workspace whose agents only watch background work shows the radio mark, not the spinner (VIEW-040, STAT-024)", () => {
  // The hook keeps a monitoring pane at working; the flag turns the spinner into the radio mark.
  expect(dirMark("working", false, true)).toBe("background");
  expect(dirMark("working", true, true)).toBe("background");
  // A request for the user still beats it; the flag means nothing once the work has stopped.
  expect(dirMark("permission", true, true)).toBe("permission");
  expect(dirMark("done", false, true)).toBe("done");
  expect(dirMark("done", true, true)).toBe("unread");
  // One pane still really working in the same folder keeps the spinner.
  expect(dirMonitoring([{ state: "working", monitoring: true }, { state: "working" }])).toBe(false);
  expect(dirMonitoring([{ state: "working", monitoring: true }, { state: "done" }])).toBe(true);
  expect(dirMonitoring([{ state: "done", monitoring: true }])).toBe(false);
  expect(dirMonitoring([])).toBe(false);
  const html = renderToStaticMarkup(createElement(RowMark, { mark: "background", since: 1, now: 1 + 3 * 60_000 }));
  expect(html).toContain('aria-label="monitoring"');
  expect(html).toContain("badge background");
  expect(html).toContain(">3m<");
});

test("ages read in minutes for the first hour, hours until two days, then days (VIEW-040)", () => {
  const m = 60_000;
  const h = 60 * m;
  expect(paletteAge(0, 30_000)).toBe("now");
  expect(paletteAge(0, 4 * m)).toBe("4m");
  expect(paletteAge(0, 50 * m)).toBe("50m");
  expect(paletteAge(0, 60 * m - 1)).toBe("59m");
  expect(paletteAge(0, h)).toBe("1h");
  expect(paletteAge(0, 3 * h)).toBe("3h");
  expect(paletteAge(0, 48 * h - 1)).toBe("47h");
  expect(paletteAge(0, 48 * h)).toBe("2d");
  expect(paletteAge(0, 72 * h)).toBe("3d");
});

const it2 = (section: string, label: string, extra: Partial<PaletteItem> = {}): PaletteItem => ({ section, label, run: () => {}, ...extra });

test("VIEW-038: on a tie the one used last comes first, and open tabs lead", () => {
  const items = [it2("Workspaces", "fix-a", { dir: "C:/a" }), it2("Workspaces", "fix-b", { dir: "C:/b" })];
  expect(paletteRows(items, "fix", ["C:/b", "C:/a"]).map((r) => r.label)).toEqual(["fix-b", "fix-a"]);
  expect(paletteRows(items, "fix", ["C:/a"]).map((r) => r.label)).toEqual(["fix-a", "fix-b"]);
  const tie = [it2("Workspaces", "build"), it2("Open tabs", "build")];
  expect(paletteRows(tie, "build").map((r) => r.section)).toEqual(["Open tabs", "Workspaces"]);
  // the exact match leads, whatever its section
  const mixed = [it2("Open tabs", "login page"), it2("Workspaces", "login")];
  expect(paletteRows(mixed, "login").map((r) => r.label)).toEqual(["login", "login page"]);
  // a match on the row itself beats one found only on its project
  const own = [it2("Workspaces", "login", { parent: "app" }), it2("Workspaces", "app-docs", { parent: "web" })];
  expect(paletteRows(own, "app").map((r) => r.label)).toEqual(["app-docs", "login"]);
  // no query: section order, as listed
  expect(paletteRows([it2("Settings", "x"), it2("Open tabs", "y")], "").map((r) => r.label)).toEqual(["y", "x"]);
});

test("VIEW-041: repository chips keep either repository; different fields must all match", () => {
  const two: Project = { id: "p2", name: "web", path: "C:/src/web" };
  const three: Project = { id: "p3", name: "docs", path: "C:/src/docs" };
  const lists = { p1: ws, p2: [{ path: "C:/src/web", branch: "main", head: "1", isMain: true }], p3: [] };
  const items = withRepos([...worktreeItems([proj, two, three], lists, false, () => null, () => {}), it2("Open tabs", "shell", { dir: "C:\\ws\\app\\login\\src" }), it2("Settings", "Terminal")], lists);
  expect(items.find((i) => i.label === "shell")?.repo).toBe("p1");
  const repos = (chips: { field: "repo" | "section"; value: string }[]) => [...new Set(chipFilter(items, chips).map((i) => i.repo ?? "none"))].sort();
  expect(repos([{ field: "repo", value: "p1" }, { field: "repo", value: "p2" }])).toEqual(["p1", "p2"]);
  expect(chipFilter(items, [{ field: "repo", value: "p1" }, { field: "section", value: "Open tabs" }]).map((i) => i.label)).toEqual(["shell"]);
  expect(chipFilter(items, []).length).toBe(items.length);
  // options sort by workspace count; hidden ones do not count
  expect(repoOptions([three, two, proj], lists).map((o) => [o.id, o.count])).toEqual([["p1", 2], ["p2", 1], ["p3", 0]]);
});

test("VIEW-042: worktree-only actions are not runnable without a worktree", () => {
  const items = [it2("Quick actions", "Remove this workspace", { needs: "worktree" }), it2("Quick actions", "New session")];
  expect(paletteRows(items, "", [], false).map((r) => [r.label, r.off])).toEqual([["Remove this workspace", true], ["New session", false]]);
  expect(paletteRows(items, "", [], true).every((r) => !r.off)).toBe(true);
});

test("EDIT-047: the palette finds a worktree by number, link, shortcode, comment, and recent ones lead an empty box", () => {
  const p: Project = { ...proj, id: "p1", name: "app" };
  const list: Worktree[] = [
    { path: "C:/src/app", branch: "main", head: "1", isMain: true },
    { path: "C:/ws/app/typo", branch: "fix-12-typo", head: "2", isMain: false },
    { path: "C:/ws/app/pay", branch: "pay-flow", head: "3", isMain: false, number: 12, comment: "flaky checkout test" },
    { path: "C:/ws/app/ship", branch: "ship", head: "4", isMain: false, name: "\u{1F680} launch" },
  ];
  const items = worktreeItems([p], { p1: list }, true, () => null, () => {});
  const first = (q: string) => paletteRows(items, q).filter((r) => r.section === "Workspaces")[0]?.dir;
  expect(first("12")).toBe("C:/ws/app/pay");
  expect(first("#12")).toBe("C:/ws/app/pay");
  expect(first("https://github.com/o/app/pull/12")).toBe("C:/ws/app/pay");
  expect(first(":rocket:")).toBe("C:/ws/app/ship");
  expect(first("flaky")).toBe("C:/ws/app/pay");
  expect(first("app pay")).toBe("C:/ws/app/pay");
  // every word has to land: "pay" fits one worktree, "zebra" none, so nothing is listed
  expect(paletteRows(items, "pay zebra")).toEqual([]);
  // an empty box: the worktree used last leads its section
  const empty = paletteRows(items, "", ["C:/ws/app/ship", "C:/ws/app/typo"]).filter((r) => r.section === "Workspaces");
  expect(empty.map((r) => r.dir)).toEqual(["C:/ws/app/ship", "C:/ws/app/typo", "C:/src/app", "C:/ws/app/pay"]);
});

test("PROJ-056 back and forward work only in the terminal view and not under settings", () => {
  expect(stepAllowed(true, false)).toBe(true);
  expect(stepAllowed(true, true)).toBe(false);
  expect(stepAllowed(false, false)).toBe(false);
});
