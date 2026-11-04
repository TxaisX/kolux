import { expect, test } from "vitest";
import panelSrc from "./ProjectsPanel.tsx?raw";
import { unlessSame } from "./ProjectsPanel";
import { afterScan, prefixSample, folderName, matchLetters, middle, pathHints, rankProjects, shortcodes, openedWorktree, relPath, nestRows, orderWorktrees, parentChoices, placeFieldAction, previewSentence, worktreeLabel, type Worktree, createOpens, overtakenBy, prItems, waitsForSetup, workItem, keepOnSwitch, itemLabel, bound, stoppedNote, splitGitSaid, type Linked, type PendingCreate, type PrHead } from "./model";

const main: Worktree = { path: "C:\\src\\app", branch: "main", head: "aaaaaaa1", isMain: true };
const zeta: Worktree = { path: "C:\\ws\\app\\zeta", branch: "zeta", head: "bbbbbbb2", isMain: false };
const fix: Worktree = { path: "C:\\ws\\app\\fix-login", branch: "fix-login", head: "ccccccc3", isMain: false };
const loose: Worktree = { path: "C:\\ws\\app\\loose", branch: null, head: "ddddddd4ddd", isMain: false };

test("rows say the typed name, else the branch, else the short commit when detached", () => {
  expect(worktreeLabel({ ...fix, name: "Fix login \u{1F525}" })).toBe("Fix login \u{1F525}");
  expect(worktreeLabel(fix)).toBe("fix-login");
  expect(worktreeLabel(loose)).toBe("detached at ddddddd");
});

test("GIT-064: with neither a branch nor a commit known, no detached label shows; the row keeps its folder name", () => {
  expect(worktreeLabel({ ...loose, head: "" })).toBe("loose");
  expect(worktreeLabel({ ...loose, head: "" })).not.toContain("detached");
});

test("the main checkout is listed first, the rest by name, whatever order git gave", () => {
  expect(orderWorktrees([zeta, loose, fix, main]).map(worktreeLabel)).toEqual(["main", "detached at ddddddd", "fix-login", "zeta"]);
});

test("folder names come off either slash style", () => {
  expect(folderName("C:\\ws\\app\\fix-login")).toBe("fix-login");
  expect(folderName("/home/t/ws/app/")).toBe("app");
});

test("the preview sentence explains the branch and folder, or the refusal", () => {
  const project = { id: "app-1", name: "app", path: "C:\\src\\app" };
  expect(previewSentence("", null, project)).toMatch(/Type a name/);
  expect(previewSentence("???", null, project)).toMatch(/nothing usable/);
  expect(previewSentence("Fix login", { branch: "fix-login", folder: "C:\\ws\\app\\fix-login" }, project)).toBe("branch fix-login · folder C:\\ws\\app\\fix-login");
  expect(previewSentence("x", { branch: "x", folder: "" }, null)).toBe("Add a project first.");
});

test("the composer shows no refusal while Git has not yet answered for the prefilled name", () => {
  const project = { id: "app-1", name: "app", path: "C:\src\app" };
  // audit flow 4: a valid prefilled name read "nothing usable" until the first answer arrived
  expect(previewSentence("dusky-puffin", null, project, true)).not.toMatch(/nothing usable/);
  expect(previewSentence("dusky-puffin", null, project, true)).toMatch(/Working out/);
  // an answered refusal for a typed name still shows (PROJ-021 / SESS-036 untouched)
  expect(previewSentence("???", null, project, false)).toMatch(/nothing usable/);
  expect(previewSentence("???", null, project)).toMatch(/nothing usable/);
});

// PROJ-047: child workspaces nest under their parent.
const p: Worktree = { path: "C:\ws\app\p", branch: "p", head: "e1", isMain: false };
const child: Worktree = { path: "C:\ws\app\child", branch: "child", head: "e2", isMain: false, parent: p.path };
const grand: Worktree = { path: "C:\ws\app\grand", branch: "grand", head: "e3", isMain: false, parent: child.path };
const orphan: Worktree = { path: "C:\ws\app\orphan", branch: "orphan", head: "e4", isMain: false, parent: "C:\ws\app\gone" };
const shape = (rows: ReturnType<typeof nestRows>) => rows.map((r) => `${"-".repeat(r.depth)}${worktreeLabel(r.w)}${r.kids ? "+" : ""}`);

test("a child sits under its parent, to any depth; a child whose parent is gone is top level", () => {
  expect(shape(nestRows([grand, zeta, orphan, child, p], true, new Set()))).toEqual(["orphan", "p+", "-child+", "--grand", "zeta"]);
  expect(shape(nestRows([{ ...fix, parent: main.path }], true, new Set()))).toEqual(["fix-login"]); // made from main: top level
});

test("folding a parent hides everything under it; nesting off is one flat level", () => {
  expect(shape(nestRows([grand, child, p, zeta], true, new Set([p.path])))).toEqual(["p+", "zeta"]);
  expect(shape(nestRows([grand, child, p, zeta], true, new Set([child.path])))).toEqual(["p+", "-child+", "zeta"]);
  expect(shape(nestRows([grand, child, p, zeta], false, new Set([p.path])))).toEqual(["child", "grand", "p", "zeta"]);
});

test("a loop of parents is listed flat rather than lost", () => {
  const a: Worktree = { ...p, parent: child.path };
  expect(shape(nestRows([a, child], true, new Set())).sort()).toEqual(["child", "p"]);
});

test("nesting keeps the order it is handed when the list is sorted elsewhere (PROJ-050)", () => {
  expect(shape(nestRows([zeta, child, p], true, new Set(), (ws) => ws))).toEqual(["zeta", "p+", "-child"]);
});

test("New workspace with no project yet opens the add-project form instead of a dead name field (T-013-fix-a)", () => {
  expect(createOpens("")).toBe("add");
  expect(createOpens("app-1")).toBe("name");
});

test("the agent waits for setup only in new-tab mode with wait on (PROJ-033)", () => {
  expect(waitsForSetup("tab", true, true, true)).toBe(true);
  expect(waitsForSetup("right", true, true, true)).toBe(false);
  expect(waitsForSetup("down", true, true, true)).toBe(false);
  expect(waitsForSetup("tab", false, true, true)).toBe(false);
  expect(waitsForSetup("tab", true, false, true)).toBe(false);
  expect(waitsForSetup("tab", true, true, false)).toBe(false);
});

test("the pull-request picker matches number, title or head branch (PROJ-030)", () => {
  const prs: PrHead[] = [
    { number: 12, title: "Fix the login page", url: "u12", headRefName: "feat/login", headRefOid: "a" },
    { number: 130, title: "Docs", url: "u130", headRefName: "main", headRefOid: "b", isCrossRepository: true, headRepositoryOwner: { login: "someone" } },
  ];
  expect(prItems(prs, "").map((i) => i.key)).toEqual(["12", "130"]);
  expect(prItems(prs, "#1").map((i) => i.key)).toEqual(["12", "130"]);
  expect(prItems(prs, "13").map((i) => i.key)).toEqual(["130"]);
  expect(prItems(prs, "LOGIN").map((i) => i.key)).toEqual(["12"]);
  expect(prItems(prs, "docs")[0]).toEqual({ key: "130", label: "#130 Docs", hint: "someone:main" });
  expect(prItems(prs, "nothing")).toEqual([]);
});

test("a newer create overtakes every running one not made with Create more (PROJ-020)", () => {
  const a: PendingCreate = { ticket: 1, projectId: "app", name: "fix-login", more: false };
  const b: PendingCreate = { ticket: 2, projectId: "app", name: "batch-1", more: true };
  const c: PendingCreate = { ticket: 3, projectId: "web", name: "docs", more: false };
  expect(overtakenBy([], c)).toEqual([]);
  // Another project's create is overtaken too: only one create can take the front.
  expect(overtakenBy([a, b], c)).toEqual([1]);
  // Create more asked for several, so its creates are never overtaken.
  expect(overtakenBy([b], c)).toEqual([]);
  expect(overtakenBy([a, b, c], c)).toEqual([1]);
});

test("the workspaces-folder field saves on Enter, reverts on Escape and ignores keys mid-composition (SET-032)", () => {
  expect(placeFieldAction("Enter", false)).toBe("save");
  expect(placeFieldAction("Escape", false)).toBe("revert");
  expect(placeFieldAction("Enter", true)).toBeNull();
  expect(placeFieldAction("Escape", true)).toBeNull();
  expect(placeFieldAction("a", false)).toBeNull();
});

test("hidden worktrees are listed relative to the project folder", () => {
  expect(relPath("C:\\src\\app", "C:\\src\\app\\.worktrees\\x")).toBe(".worktrees/x");
  expect(relPath("C:\\src\\app", "C:\\ws\\app\\fix-login")).toBe("../../ws/app/fix-login");
  expect(relPath("c:/src/app/", "C:\\SRC\\app")).toBe(".");
  expect(relPath("C:\\src\\app", "D:\\other\\x")).toBe("D:\\other\\x");
});

// PROJ-006: a linked worktree added as its own project opens on that folder, not the main checkout.
test("the workspace opened after adding is the folder picked, else the main checkout", () => {
  expect(openedWorktree([main, zeta], "c:/ws/app/zeta/")?.path).toBe(zeta.path);
  expect(openedWorktree([zeta, main], "C:\src\app")?.path).toBe(main.path);
  expect(openedWorktree([zeta, main], "D:\elsewhere")?.path).toBe(main.path);
  expect(openedWorktree([], "C:\src\app")).toBeUndefined();
});

// SESS-035: the composer's project list.
test("typed letters are found in order, a run of them beats scattered ones, and recent projects lead", () => {
  expect(matchLetters("api", "my-api")).toEqual([3, 4, 5]);
  expect(matchLetters("ai", "my-api")).toEqual([3, 5]);
  expect(matchLetters("zz", "my-api")).toBeNull();
  const ps = [
    { id: "1", name: "alpha-pi", path: "C:/src/alpha-pi" },
    { id: "2", name: "api", path: "C:/work/api" },
    { id: "3", name: "notes", path: "C:/notes" },
  ];
  const r = rankProjects(ps, "api", []);
  expect(r.recent).toEqual([]);
  expect(r.rest.map((m) => m.p.id)).toEqual(["2", "1"]);
  expect(rankProjects(ps, "api", ["1"]).recent.map((m) => m.p.id)).toEqual(["1"]);
  expect(rankProjects(ps, "", ["3"]).rest.map((m) => m.p.id)).toEqual(["1", "2"]);
});

test("projects sharing a name get enough of their path to tell them apart, long text shortened in the middle", () => {
  const hints = pathHints([
    { id: "a", name: "api", path: "C:/work/client/api" },
    { id: "b", name: "api", path: "D:/home/client/api" },
    { id: "c", name: "web", path: "C:/web" },
  ]);
  expect(hints).toEqual({ a: "work/client", b: "home/client" });
  expect(pathHints([
    { id: "w", name: "api", path: "C:\\one\\client\\api" },
    { id: "v", name: "api", path: "C:\\two\\client\\api" },
  ])).toEqual({ w: "one\\client", v: "two\\client" });
  expect(middle("abcdefghij", 7)).toBe("abc…hij");
  expect(middle("short", 7)).toBe("short");
});

// SESS-036: emoji shortcodes in the name.
test("emoji shortcodes turn into emoji and unknown ones are left alone", () => {
  expect(shortcodes("Fix :bug: fast :rocket:")).toBe("Fix \u{1F41B} fast \u{1F680}");
  expect(shortcodes(":nope: a:b")).toBe(":nope: a:b");
});

test("ACCT-056: a failed scan keeps the worktrees already known; a scan that worked replaces them", () => {
  const known = [{ path: "C:/r/a", branch: "a", head: "1", isMain: false }];
  expect(afterScan(known, null)).toBe(known);
  expect(afterScan(undefined, null)).toEqual([]);
  expect(afterScan(known, [])).toEqual([]);
});

test("SET-031: the prefix field shows the next branch name and says when the prefix is not used", () => {
  expect(prefixSample("custom", "tx", { prefix: "tx/", refused: false })).toEqual({ sample: "tx/<name>", note: null });
  expect(prefixSample("custom", "a b", { prefix: "", refused: true })).toEqual({ sample: "<name>", note: 'Git does not accept "a b" in a branch name, so new branches get no prefix.' });
  expect(prefixSample("custom", " /// ", { prefix: "", refused: false }).note).toBe("A prefix of only slashes is no prefix, so new branches get the bare name.");
  expect(prefixSample("user", "", { prefix: "txais-xiong/", refused: false })).toEqual({ sample: "txais-xiong/<name>", note: null });
  expect(prefixSample("none", "tx", null)).toEqual({ sample: "<name>", note: null });
});

test("PROJ-048: a new parent is never the workspace itself, its parent, its descendants or the main checkout", () => {
  const w = (name: string, parent?: string): Worktree => ({ path: "C:/ws/" + name, branch: name, head: "c", isMain: false, parent: parent && "C:/ws/" + parent });
  const all = [main, w("p"), w("a", "p"), w("kid", "a"), w("grand", "kid"), w("b"), w("loop1", "loop2"), w("loop2", "loop1")];
  const names = (x: Worktree) => parentChoices(all, x).map((c) => c.branch);
  expect(names(all[2])).toEqual(["b", "loop1", "loop2"]);
  expect(names(all[5])).toEqual(["p", "a", "kid", "grand", "loop1", "loop2"]);
  // a loop of parents does not hang the walk, and the other loop member is a descendant
  expect(names(all[6])).toEqual(["p", "a", "kid", "grand", "b"]);
  // a parent that is no longer listed is not "the current parent"
  expect(names(w("lost", "gone"))).toEqual(["p", "a", "kid", "grand", "b", "loop1", "loop2"]);
});

test("PROJ-037: an issue or pull request address is a work item; a plain name or a repository home page is not", () => {
  expect(workItem(" https://github.com/Acme/app/pull/12 ")).toEqual({ host: "github.com", owner: "Acme", repo: "app", kind: "pull", number: 12 });
  expect(workItem("https://github.com/acme/app/pull/12/files#diff")?.number).toBe(12);
  expect(workItem("https://www.github.com/acme/app/issues/34?x=1")).toEqual({ host: "github.com", owner: "acme", repo: "app", kind: "issue", number: 34 });
  expect(workItem("https://ghe.corp.example/team/app/issues/3")?.host).toBe("ghe.corp.example");
  expect(workItem("https://github.com/acme/app")).toBeNull();
  expect(workItem("https://github.com/acme/app/pulls")).toBeNull();
  expect(workItem("https://github.com/acme/app/issues/0")).toBeNull();
  expect(workItem("fix the login page")).toBeNull();
  expect(workItem("#12")).toBeNull();
});

test("SESS-036/038: a linked GitHub item reads as its number and title, and a project switch drops it but keeps a tracker link", () => {
  const issue: Linked = { kind: "issue", number: 34, title: "Crash on save", url: "https://github.com/acme/app/issues/34", repo: "github.com/acme/app" };
  const pr: Linked = { ...issue, kind: "pull", number: 12, title: "Fix the login page" };
  expect(itemLabel(issue)).toBe("issue #34 Crash on save");
  expect(itemLabel(pr)).toBe("pull request #12 Fix the login page");
  expect(keepOnSwitch(issue)).toBeNull();
  expect(keepOnSwitch(pr)).toBeNull();
  const tracker: Linked = { kind: "tracker", number: 7, title: "Plan the launch", url: "https://tracker.example/7", repo: null };
  expect(keepOnSwitch(tracker)).toBe(tracker);
  expect(keepOnSwitch(null)).toBeNull();
  expect(bound({ kind: "issue", number: 34, title: "t", url: "https://github.com/Acme/App/issues/34" }).repo).toBe("github.com/Acme/App");
});

test("SESS-038: what a create cancelled mid-submit tells the user", () => {
  expect(stoppedNote("login", "cancelled: a newer workspace creation took its place")).toEqual({ kind: "ok", text: "Stopped creating login; nothing was left behind." });
  expect(stoppedNote("login", "cancelled: a newer workspace creation took its place, but its folder could not be removed: busy")).toEqual({ kind: "warn", text: "Stopped creating login, but its folder could not be removed: busy" });
  expect(stoppedNote("login", "fatal: invalid reference: x")).toEqual({ kind: "warn", text: "login: fatal: invalid reference: x" });
  expect(stoppedNote("login", null)).toEqual({ kind: "warn", text: "login was already made when the cancel arrived, so it stays; delete it if you do not want it." });
});

test("PROJ-031: a failed create splits into Kolux's words and Git's full output", () => {
  const raw = "The workspace could not be made: that name is in use. Choose another." + "\nGit said: fatal: 'x' already exists" + "\nsecond line";
  expect(splitGitSaid(raw)).toEqual({ summary: "The workspace could not be made: that name is in use. Choose another.", git: "fatal: 'x' already exists\nsecond line" });
  expect(splitGitSaid("plain")).toEqual({ summary: "plain", git: null });
});

test("T-726: an unchanged scan keeps the same state, so the sidebar does not repaint every 5 s", () => {
  const prev = { p1: [{ path: "C:/w", branch: "main" }] };
  expect(unlessSame({ p1: [{ path: "C:/w", branch: "main" }] })(prev), "same content: the old object, React skips the render").toBe(prev);
  const moved = { p1: [{ path: "C:/w", branch: "dev" }] };
  expect(unlessSame(moved)(prev), "changed: the new one").toBe(moved);
  // every setter the 5 s poll calls goes through it
  for (const set of ["setWorktrees", "setHiddenWts", "setFresh", "setPushedBy"]) expect(panelSrc, set).toMatch(new RegExp(set + "\\(unlessSame\\("));
});
