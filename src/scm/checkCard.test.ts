// T-235-b (EDIT-030): the CI check tab's pure rules: one tab per check per worktree (by id, never by name),
// annotations open only inside the worktree, the card text, and when Fix with AI is on.
import { expect, test } from "vitest";
import { checkIdOf, checkKey, findCheckPane, type CheckDetail, type CheckRef } from "./checkCard";
import { cardText, fixBlockerFor, insideWorktree } from "./checkText";
import { tabMenu } from "../terminal/tabs";
import { tabName } from "../terminal/tabName";
import { layoutOf } from "../terminal/layout";
import { scopesFor } from "../keys/keyScopes";
import type { Pane } from "../App";

const ref = (over: Partial<CheckRef> = {}): CheckRef => ({
  id: 9,
  name: "build",
  link: "https://github.com/acme/app/actions/runs/42/job/9",
  outcome: "failed",
  workflow: "CI",
  pr: { number: 7, url: "https://github.com/acme/app/pull/7", state: "OPEN" },
  ...over,
});

test("a check's id is the job (or check run) number in its address", () => {
  expect(checkIdOf("https://github.com/acme/app/actions/runs/42/job/9")).toBe(9);
  expect(checkIdOf("https://github.com/acme/app/runs/55?check_suite_focus=true")).toBe(55);
  expect(checkIdOf("https://github.com/acme/app/actions/runs/42")).toBeNull();
  expect(checkIdOf("https://ci.example/build/9")).toBeNull();
  expect(checkIdOf(null)).toBeNull();
});

test("a second open finds the existing tab: by id and worktree, never by name", () => {
  const mk = (key: number, cwd: string | null, id: number, name: string): Pane => ({ key, cwd, branch: null, agent: "shell", program: null, args: [], kind: "check", check: ref({ id, name }) });
  const panes: Pane[] = [
    mk(1, "C:\\w\\proj", 9, "build"),
    mk(2, "C:\\w\\proj", 10, "build"), // same name, another job
    mk(3, "C:\\w\\other", 9, "build"), // same job id in another worktree
    { key: 4, cwd: "C:\\w\\proj", branch: null, agent: "shell", program: null, args: [], kind: "preview", path: "a.md" },
  ];
  expect(findCheckPane(panes, "C:\\w\\proj", 9)?.key).toBe(1);
  expect(findCheckPane(panes, "C:\\w\\proj", 10)?.key).toBe(2);
  expect(findCheckPane(panes, "C:\\w\\other", 9)?.key).toBe(3);
  expect(findCheckPane(panes, "C:\\w\\proj", 11)).toBeUndefined();
  expect(findCheckPane(panes, null, 9)).toBeUndefined();
  expect(checkKey("C:\\w\\proj", 9)).toBe("C:\\w\\proj::check:9");
});

test("an annotation opens only inside the worktree: relative paths are joined, escapes and outside paths refused", () => {
  const win = "C:\\w\\proj";
  expect(insideWorktree(win, "src/a.rs")).toBe("C:\\w\\proj\\src\\a.rs");
  expect(insideWorktree(win, "src\\b\\..\\a.rs")).toBe("C:\\w\\proj\\src\\a.rs");
  expect(insideWorktree(win, "./src/a.rs")).toBe("C:\\w\\proj\\src\\a.rs");
  expect(insideWorktree(win, "../x.rs")).toBeNull();
  expect(insideWorktree(win, "src/../../x.rs")).toBeNull();
  expect(insideWorktree(win, "../../etc/passwd")).toBeNull();
  expect(insideWorktree(win, "C:\\w\\other\\a.rs")).toBeNull();
  expect(insideWorktree(win, "C:\\w\\projx\\a.rs")).toBeNull();
  expect(insideWorktree(win, "D:\\w\\proj\\a.rs")).toBeNull();
  expect(insideWorktree(win, "\\\\server\\share\\a.rs")).toBeNull();
  expect(insideWorktree(win, "")).toBeNull();
  expect(insideWorktree(win, "C:\\w\\proj")).toBeNull(); // the folder itself is not a file
  // an absolute path inside is fine, with either slash and either drive-letter case
  expect(insideWorktree(win, "c:/w/proj/src/a.rs")).toBe("C:\\w\\proj\\src\\a.rs");
  expect(insideWorktree("c:\\w\\proj", "C:\\w\\PROJ\\src\\a.rs")).toBe("c:\\w\\proj\\src\\a.rs");
  const posix = "/home/u/p";
  expect(insideWorktree(posix, "src/a.rs")).toBe("/home/u/p/src/a.rs");
  expect(insideWorktree(posix, "/home/u/p/src/a.rs")).toBe("/home/u/p/src/a.rs");
  expect(insideWorktree(posix, "/etc/passwd")).toBeNull();
  expect(insideWorktree(posix, "/home/u/p/../q/a.rs")).toBeNull();
  expect(insideWorktree(posix, "/home/u/pp/a.rs")).toBeNull();
});

test("a path Windows would read as something else never opens: drive-relative, device names, trailing dot or space", () => {
  const win = "C:\\w\\proj";
  expect(insideWorktree(win, "C:foo")).toBeNull(); // drive-relative, not under the worktree
  expect(insideWorktree(win, "src/C:foo")).toBeNull();
  expect(insideWorktree(win, "src/a.rs:stream")).toBeNull(); // an alternate data stream
  expect(insideWorktree(win, "\\\\?\\C:\\x")).toBeNull(); // a device-namespace path
  expect(insideWorktree(win, "NUL")).toBeNull();
  expect(insideWorktree(win, "src/aux.txt")).toBeNull();
  expect(insideWorktree(win, "src/Com1")).toBeNull();
  expect(insideWorktree(win, "lpt9.tar.gz")).toBeNull();
  expect(insideWorktree(win, "foo./bar")).toBeNull();
  expect(insideWorktree(win, "foo /bar")).toBeNull();
  expect(insideWorktree(win, "src/a.rs.")).toBeNull();
  expect(insideWorktree(win, "src/../../x")).toBeNull(); // .. still refused
  // near misses are ordinary names
  expect(insideWorktree(win, "src/auxiliary.txt")).toBe("C:\\w\\proj\\src\\auxiliary.txt");
  expect(insideWorktree(win, "src/com10.txt")).toBe("C:\\w\\proj\\src\\com10.txt");
  // a percent-encoded dot pair is a literal name, not a climb: it stays inside the worktree
  expect(insideWorktree(win, "%2e%2e/x")).toBe("C:\\w\\proj\\%2e%2e\\x");
});

test("the card text carries the name, result, pull request, steps and annotations", () => {
  const detail: CheckDetail = {
    steps: [
      { number: 1, name: "Set up job", status: "completed", conclusion: "success" },
      { number: 2, name: "Run tests", status: "completed", conclusion: "failure" },
      { number: 3, name: "Upload", status: "in_progress", conclusion: null },
    ],
    annotations: [{ path: "src/a.rs", startLine: 4, endLine: 6, level: "failure", title: "E0308", message: "mismatched types" }],
  };
  const text = cardText(ref(), detail);
  expect(text).toContain("build (CI)");
  expect(text).toContain("failed");
  expect(text).toContain("#7");
  expect(text).toContain("2. Run tests: failure");
  expect(text).toContain("3. Upload: in_progress");
  expect(text).toContain("failure src/a.rs:4-6 E0308: mismatched types");
  expect(cardText(ref(), { steps: [], annotations: [] })).toContain("No steps reported");
  expect(cardText(ref({ pr: null }), null)).not.toContain("Pull request");
});

test("Fix with AI is on only for a failed check on an open pull request with a workflow run and a workspace", () => {
  const ws = "C:\\w\\proj";
  expect(fixBlockerFor(ref(), ws)).toBeNull();
  expect(fixBlockerFor(ref({ outcome: "passed" }), ws)).toMatch(/failed/);
  expect(fixBlockerFor(ref({ outcome: "running" }), ws)).toMatch(/failed/);
  expect(fixBlockerFor(ref({ pr: { number: 7, url: "u", state: "CLOSED" } }), ws)).toMatch(/not open/);
  expect(fixBlockerFor(ref({ pr: { number: 7, url: "u", state: "MERGED" } }), ws)).toMatch(/not open/);
  expect(fixBlockerFor(ref({ pr: null }), ws)).toMatch(/no pull request/);
  expect(fixBlockerFor(ref({ link: "https://ci.example/build/9" }), ws)).toMatch(/workflow run/);
  expect(fixBlockerFor(ref(), null)).toMatch(/workspace/);
});

test("the tab shows the check's name and no path, has no copy-path or rename item, is not saved, and takes the tab keys", () => {
  const pane: Pane = { key: 5, cwd: "C:\\w\\proj", branch: null, agent: "shell", program: null, args: [], kind: "check", check: ref({ name: "lint" }) };
  expect(tabName(pane, {})).toBe("lint");
  expect(tabName({ ...pane, check: undefined }, {})).toBe("Check");
  expect(tabMenu("check").map((m) => m.id)).toEqual(["close"]);
  expect(layoutOf([pane], {}, 5, "C:\\w\\proj", {}).panes).toEqual([]);
  expect(scopesFor({ screen: "terminals", kind: "check", inTree: false })).toEqual(["global", "tabs"]);
});
