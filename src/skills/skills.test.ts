// SKILL-017 / SKILL-018: what the Skills page shows from a scan, and the sidebar button.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import SkillsRow from "../projects/SkillsRow";
import { CHROME, chromeShown } from "../chrome/chromeItems";
import { NO_FILTERS, escapeCloses, filtersOn, rootState, shortPath, sourceCounts, viewOf, visible, type Root, type Scan, type Skill } from "./skills";

const sk = (name: string, source: Skill["source"], agents: Skill["agents"], extra: Partial<Skill> = {}): Skill => ({
  name,
  description: `${name} does things`,
  updated: 1_760_000_000_000,
  path: `C:\\Users\\me\\.x\\skills\\${name}\\SKILL.md`,
  source,
  agents,
  plugin: null,
  ...extra,
});
const root = (state: Root["state"], extra: Partial<Root> = {}): Root => ({ path: "C:\\r", label: "R", source: "home", agents: [], state, count: 0, note: null, ...extra });

const skills = [
  sk("release-notes", "home", ["claude"]),
  sk("tidy", "home", ["shared", "codex"]),
  sk("repo-rules", "workspace", ["claude"]),
  sk("pdf", "plugin", ["claude"], { plugin: "docs" }),
  sk("kolux-cli", "bundled", []),
];

test("SKILL-017: home and repo skills both show, with correct source counts", () => {
  expect(visible(skills, NO_FILTERS)).toHaveLength(5);
  expect(sourceCounts(skills, NO_FILTERS)).toEqual({ home: 2, workspace: 1, bundled: 1, plugin: 1 });
});

test("SKILL-017: Filter by Codex keeps only skills Codex can see; Clear filters brings them all back", () => {
  const codex = { ...NO_FILTERS, agent: "codex" as const };
  expect(visible(skills, codex).map((s) => s.name)).toEqual(["tidy"]);
  expect(sourceCounts(skills, codex)).toEqual({ home: 1, workspace: 0, bundled: 0, plugin: 0 });
  expect(filtersOn(codex)).toBe(true);
  expect(filtersOn(NO_FILTERS)).toBe(false);
  expect(visible(skills, NO_FILTERS)).toHaveLength(5);
  // The shared skills folder is a filter of its own.
  expect(visible(skills, { ...NO_FILTERS, agent: "shared" }).map((s) => s.name)).toEqual(["tidy"]);
});

test("SKILL-017: source chips and search narrow the list; every word has to match", () => {
  expect(visible(skills, { ...NO_FILTERS, sources: ["workspace", "plugin"] }).map((s) => s.name)).toEqual(["repo-rules", "pdf"]);
  expect(visible(skills, { ...NO_FILTERS, query: "REPO things" }).map((s) => s.name)).toEqual(["repo-rules"]);
  expect(visible(skills, { ...NO_FILTERS, query: "nothing-like-this" })).toHaveLength(0);
});

test("SKILL-017: scanning, failed, empty, no matches and list states", () => {
  const ok: Scan = { skills, roots: [root("scanned")] };
  expect(viewOf(null, null, true, 0)).toBe("scanning");
  expect(viewOf(null, "boom", false, 0)).toBe("failed");
  // A root that failed partway makes the page a failure with Retry, never a shorter list.
  expect(viewOf({ skills, roots: [root("scanned"), root("error", { note: "Took longer than 8 seconds" })] }, null, false, 5)).toBe("failed");
  expect(viewOf({ skills: [], roots: [root("not-found")] }, null, false, 0)).toBe("empty");
  expect(viewOf(ok, null, false, 0)).toBe("no-matches");
  expect(viewOf(ok, null, false, 5)).toBe("list");
});

test("SKILL-017: the folders popover names each root's state", () => {
  expect(rootState(root("scanned", { count: 1 }))).toBe("1 skill");
  expect(rootState(root("not-found"))).toBe("Not found");
  expect(rootState(root("not-scanned", { note: "the plugin cache limit was reached" }))).toBe("Not scanned: the plugin cache limit was reached");
  expect(rootState(root("error", { note: "denied" }))).toBe("Scan failed: denied");
  expect(rootState(root("partial", { count: 500, note: "Stopped after 500 skills" }))).toBe("500 skills, partly scanned: Stopped after 500 skills");
});

test("SKILL-017: long paths are shortened, short ones kept", () => {
  const long = "C:\\Users\\someone\\.codex\\plugins\\cache\\marketplace\\plugin-name\\0.6.12\\skills\\api-and-interface-design\\SKILL.md";
  const s = shortPath(long);
  expect(s.length).toBeLessThan(long.length);
  expect(s.startsWith("C:\\Users")).toBe(true);
  expect(s.endsWith("api-and-interface-design\\SKILL.md")).toBe(true);
  expect(shortPath("C:\\a\\SKILL.md")).toBe("C:\\a\\SKILL.md");
});

test("SKILL-017: Escape closes the page but never takes Escape from a focused input", () => {
  expect(escapeCloses({ tagName: "INPUT" } as unknown as EventTarget)).toBe(false);
  expect(escapeCloses({ tagName: "textarea" } as unknown as EventTarget)).toBe(false);
  expect(escapeCloses({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(false);
  expect(escapeCloses({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(true);
  expect(escapeCloses(null)).toBe(true);
});

test("SKILL-018: no Skills button on a fresh install; the button opens the page and shows as current", () => {
  expect(chromeShown({}, "skillsButton")).toBe(false);
  expect(CHROME.find((c) => c.id === "skillsButton")?.label).toBe("Show Skills button in the sidebar");
  const html = (open: boolean) => renderToString(createElement(SkillsRow, { open, onOpen: () => {}, onHide: () => {} }));
  expect(html(false)).toContain("Skills");
  expect(html(false)).not.toContain('aria-current="page"');
  expect(html(true)).toContain('aria-current="page"');
});

// SKILL-022: Delete skills.
import { BLOCKED, MAX_DELETE, OUTCOME, inWsl, canDelete, eligible, keepChosen, outcomeText, pickOf, sumUp, whyNot, type Planned } from "./skills";

test("SKILL-022: bundled and plugin skills cannot be chosen, and select all counts only rows that can be", () => {
  expect(skills.filter(canDelete).map((s) => s.name)).toEqual(["release-notes", "tidy", "repo-rules"]);
  expect(eligible(skills)).toHaveLength(3);
  expect(whyNot(skills[3])).toBe(BLOCKED.plugin);
  expect(whyNot(skills[4])).toBe(BLOCKED.bundled);
  expect(whyNot(skills[0])).toBeNull();
  expect(MAX_DELETE).toBe(512);
});

test("SKILL-022: two skills sharing a name are chosen one by one; after a rescan gone or ineligible choices drop", () => {
  const a = sk("review", "home", ["claude"], { path: String.raw`C:\a\review\SKILL.md` });
  const b = sk("review", "workspace", ["claude"], { path: String.raw`C:\b\review\SKILL.md` });
  expect(a.path).toHaveLength(20); // real backslashes, no control characters
  expect(eligible([a, b])).toEqual([a.path, b.path]);
  expect(keepChosen([a.path, b.path], [b])).toEqual([b.path]);
  expect(keepChosen([a.path], [{ ...a, source: "plugin" }])).toEqual([]);
  expect(pickOf(a)).toEqual({ path: a.path, updated: a.updated });
});

test("SKILL-022: the confirmation counts folders and links, names where linked content stays and lists blocked skills", () => {
  const plan: Planned[] = [
    { path: "h", blocked: null, items: [{ path: "h", kind: "folder" }, { path: "h.r", kind: "receipt" }, { path: "s", kind: "link" }], remains: null },
    { path: "l", blocked: null, items: [{ path: "l", kind: "link" }], remains: String.raw`D:\dev\beta` },
    { path: "kolux:x", blocked: "bundled", items: [], remains: null },
    { path: "c", blocked: "changed", items: [], remains: null },
  ];
  const s = sumUp(plan, (p) => p.toUpperCase());
  expect(s.count).toBe(2);
  expect(s.headline).toBe("2 skills will be deleted: 1 folder and 2 links removed across all skill folders.");
  expect(s.remains).toEqual([String.raw`L: only a link is removed; the content stays in D:\dev\beta`]);
  expect(s.blocked).toEqual([`KOLUX:X: ${BLOCKED.bundled}`, `C: ${BLOCKED.changed}`]);
  const gone: Planned[] = [{ path: "f", blocked: null, items: [{ path: "f", kind: "folder" }], remains: null, dangling: [String.raw`D:\team\beta`] }];
  expect(sumUp(gone, (p) => p.toUpperCase()).dangling).toEqual([String.raw`F: the link D:\team\beta is outside the skill folders, so it stays and will point at nothing`]);
  expect(gone[0].dangling?.[0]).toHaveLength(12); // real backslashes, no control characters
  expect(s.dangling).toEqual([]);
  expect(sumUp([plan[2]], (p) => p).headline).toBe("None of the chosen skills can be deleted.");
});

test("T-658 (OD-12, DT-C94): a skill in a project stored in WSL is listed by its share path but cannot be chosen", () => {
  // The scan lists it by its \\wsl.localhost\ path with source workspace; nothing runs inside the distribution.
  const inRepo = sk("lint", "workspace", ["claude"], { path: String.raw`\\wsl.localhost\Ubuntu\home\me\repo\.claude\skills\lint\SKILL.md` });
  expect(inRepo.path.startsWith("\\\\wsl.localhost\\")).toBe(true); // real backslashes, no control characters
  expect([canDelete(inRepo), whyNot(inRepo)]).toEqual([false, BLOCKED.wsl]);
  for (const p of [String.raw`\\wsl$\d\r\.claude\skills\x\SKILL.md`, String.raw`\\?\UNC\WSL.localhost\d\x\SKILL.md`, String.raw`\\.\UNC\wsl$\d\x\SKILL.md`, String.raw`\??\UNC\wsl.localhost\d\x\SKILL.md`, "//wsl.localhost/d/x/SKILL.md"]) expect(inWsl(p)).toBe(true);
  for (const p of [String.raw`\\wsl.localhost.evil\d\x\SKILL.md`, String.raw`C:\wsl.localhost\x\SKILL.md`, String.raw`\\server\wsl$\x`]) expect(inWsl(p)).toBe(false);
  expect(eligible([inRepo, skills[0]])).toEqual(eligible([skills[0]]));
  expect(keepChosen([inRepo.path], [inRepo])).toEqual([]);
  expect(outcomeText({ path: inRepo.path, outcome: "skipped", note: "wsl" })).toBe(`Skipped: ${BLOCKED.wsl}`);
  // The app's answers are the Windows ones: no "not confirmed" outcome, no "unreadable" reason.
  expect(Object.keys(OUTCOME)).not.toContain("unsure");
  expect(Object.keys(BLOCKED)).not.toContain("unreadable");
  expect(outcomeText({ path: inRepo.path, outcome: "failed", note: "Access is denied" })).toBe("Failed; nothing was changed (Access is denied)");
});

test("SKILL-022: each skill's outcome reads plainly", () => {
  expect(outcomeText({ path: "a", outcome: "deleted", note: null })).toBe("Deleted");
  expect(outcomeText({ path: "a", outcome: "skipped", note: "changed" })).toBe(`Skipped: ${BLOCKED.changed}`);
  expect(outcomeText({ path: "a", outcome: "busy", note: "x" })).toBe("Busy: another skill operation is under way");
  expect(outcomeText({ path: "a", outcome: "partly", note: "1 hidden staged copy is left over" })).toBe("Partly removed: hidden staged files are left over (1 hidden staged copy is left over)");
  expect(outcomeText({ path: "a", outcome: "failed", note: "Nothing was deleted: locked" })).toBe("Failed; nothing was changed (Nothing was deleted: locked)");
});

// SKILL-020: row actions and skill details.
import { COPIED, COPY_FAILED, ROW_ACTIONS, actionBlocked, seenBy } from "./skills";
test("SKILL-020: a row offers View details, Reveal file, Copy path and Delete; bundled and plugin rows say why one cannot run", () => {
  expect(ROW_ACTIONS.map((a) => a.label)).toEqual(["View details", "Reveal file", "Copy path", "Delete"]);
  const home = sk("tidy", "home", ["claude"]);
  expect(ROW_ACTIONS.map((a) => actionBlocked(home, a.id))).toEqual([null, null, null, null]);
  const bundled = sk("orchestration", "bundled", [], { path: "kolux:orchestration" });
  expect(actionBlocked(bundled, "details")).toBeNull();
  expect(actionBlocked(bundled, "reveal")).toMatch(/no file on disk/);
  expect(actionBlocked(bundled, "copy")).toMatch(/no file on disk/);
  expect(actionBlocked(bundled, "delete")).toBe(BLOCKED.bundled);
  const plugin = sk("pdf", "plugin", ["claude"], { plugin: "docs" });
  expect([actionBlocked(plugin, "reveal"), actionBlocked(plugin, "copy")]).toEqual([null, null]);
  expect(actionBlocked(plugin, "delete")).toBe(BLOCKED.plugin);
});

test("SKILL-020: details list the AIs that can use the skill by name", () => {
  expect(seenBy(sk("tidy", "home", ["shared", "codex", "claude"]))).toEqual(["Shared skills folder", "Codex", "Claude Code"]);
  expect(seenBy(sk("one", "workspace", ["hermes"]))).toEqual(["Hermes"]);
  expect(seenBy(sk("orchestration", "bundled", []))).toEqual(["Kolux (built in)"]);
  expect(seenBy(sk("lonely", "home", []))).toEqual([]);
  expect([COPIED, COPY_FAILED].every((t) => t.length > 0)).toBe(true);
});
