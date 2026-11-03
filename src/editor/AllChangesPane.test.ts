import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { baseCall, entryKey, estimate, openStatus, Section, sidesCall, statusGate, tagOf, WAIT_OVER, type Entry } from "./AllChangesPane";
import { readyStore } from "./sectionWindow";
import { AC_SPLIT_KEY, AC_TREE_KEY, AC_WHITESPACE_KEY, AC_WRAP_KEY, acLayoutOf, emptyStatus } from "../scm/model";

const e = (over: Partial<Entry>): Entry => ({ path: "C:/r/a.ts", staged: false, code: "M", lines: 10, binary: false, stamp: "x", ...over });

describe("All Changes sections", () => {
  it("keeps a file's staged and unstaged change apart", () => {
    expect(entryKey(e({ staged: true }))).not.toBe(entryKey(e({ staged: false })));
  });
  it("reserves a height that grows with the change up to a ceiling", () => {
    expect(estimate(e({ lines: 10 }))).toBeLessThan(estimate(e({ lines: 100 })));
    expect(estimate(e({ lines: 1000 }))).toBe(estimate(e({ lines: 1500 })));
  });
  it("gives a waiting, binary or image section a small fixed height", () => {
    expect(estimate(e({ lines: WAIT_OVER + 1 }))).toBeLessThan(100);
    expect(estimate(e({ lines: null, binary: true }))).toBeLessThan(100);
    expect(estimate(e({ path: "C:/r/logo.png", lines: null, binary: true }))).toBeLessThan(100);
  });
});

describe("GIT-038: All Changes against the branch's base", () => {
  it("reads a section's sides from the base snapshot, or from the index as before", () => {
    const base = { against: "main", since: "abc123" };
    expect(sidesCall(base, "C:/r", e({}))).toEqual(["scm_base_sides", { worktree: "C:/r", path: "C:/r/a.ts", since: "abc123" }]);
    expect(sidesCall(null, "C:/r", e({ staged: true }))).toEqual(["diff_sides", { path: "C:/r/a.ts", staged: true }]);
  });
  it("words a section by what became of the file against the base, by index side otherwise", () => {
    expect(tagOf(e({ code: "A" }), true)).toBe("Added");
    expect(tagOf(e({ code: "D" }), true)).toBe("Deleted");
    expect(tagOf(e({ code: "M" }), true)).toBe("Changed");
    expect(tagOf(e({ code: "?" }), true)).toBe("Untracked");
    expect(tagOf(e({ code: "M", staged: true }), false)).toBe("Staged");
    expect(tagOf(e({ code: "M" }), false)).toBe("Unstaged");
  });
  it("starts inline, unwrapped, whitespace hidden and the tree hidden unless a setting says otherwise", () => {
    expect(acLayoutOf(null)).toEqual({ split: false, wrap: false, spaces: false, tree: false });
    expect(acLayoutOf({ [AC_SPLIT_KEY]: true, [AC_WRAP_KEY]: "yes", [AC_WHITESPACE_KEY]: true, [AC_TREE_KEY]: true })).toEqual({ split: true, wrap: false, spaces: true, tree: true });
  });
});

describe("T-033-g: All Changes reads its base without a second status", () => {
  it("passes the base the last status named, and none before any status arrived", () => {
    expect(baseCall("C:/r", null, { ...emptyStatus, base: "main" })).toEqual(["scm_base_changes", { worktree: "C:/r", pinned: null, known: "main" }]);
    expect(baseCall("C:/r", "release", { ...emptyStatus, base: "main" })).toEqual(["scm_base_changes", { worktree: "C:/r", pinned: "release", known: "main" }]);
    expect(baseCall("C:/r", null, null)).toEqual(["scm_base_changes", { worktree: "C:/r", pinned: null, known: null }]);
    expect(baseCall("C:/r", null, emptyStatus)).toEqual(["scm_base_changes", { worktree: "C:/r", pinned: null, known: null }]);
  });
});

describe("FIX-2: the status read as the tab opens", () => {
  it("never replaces a newer status the watcher already gave", () => {
    const seen: (string | null)[] = [];
    const gate = statusGate((s) => seen.push(s.branch));
    gate.watched({ ...emptyStatus, branch: "after-commit" });
    gate.first({ ...emptyStatus, branch: "before-commit" });
    expect(seen).toEqual(["after-commit"]);
  });
  it("is used when it arrives before the watcher's first tick", () => {
    const seen: (string | null)[] = [];
    const gate = statusGate((s) => seen.push(s.branch));
    gate.first({ ...emptyStatus, branch: "open" });
    gate.watched({ ...emptyStatus, branch: "tick" });
    expect(seen).toEqual(["open", "tick"]);
  });
});

describe("FIX-3: the tab's status wiring", () => {
  const status = (branch: string) => ({ ...emptyStatus, branch });
  it("a watcher status that lands before the slow opening read is kept, and the read is dropped", async () => {
    let answer: (s: ReturnType<typeof status>) => void = () => undefined;
    const read = () => new Promise<ReturnType<typeof status>>((resolve) => (answer = resolve));
    let tick: (s: ReturnType<typeof status>) => void = () => undefined;
    const seen: (string | null)[] = [];
    const watched: (string | null)[] = [];
    const { first, stop } = openStatus(read, (on) => ((tick = on), () => seen.push("stopped")), (s) => seen.push(s.branch), (s) => watched.push(s.branch));
    tick(status("after-commit"));
    answer(status("before-commit"));
    await first;
    expect(seen).toEqual(["after-commit"]);
    expect(watched).toEqual(["after-commit"]);
    stop();
    expect(seen).toEqual(["after-commit", "stopped"]);
  });
  it("the opening read is used when it lands first, and a failed read leaves the watcher in charge", async () => {
    const seen: (string | null)[] = [];
    let tick: (s: ReturnType<typeof status>) => void = () => undefined;
    const a = openStatus(() => Promise.resolve(status("open")), (on) => ((tick = on), () => undefined), (s) => seen.push(s.branch), () => undefined);
    await a.first;
    tick(status("tick"));
    expect(seen).toEqual(["open", "tick"]);
    const b = openStatus(() => Promise.reject(new Error("gone")), (on) => ((tick = on), () => undefined), (s) => seen.push(s.branch), () => undefined);
    await expect(b.first).resolves.toBeUndefined();
    tick(status("only-watcher"));
    expect(seen).toEqual(["open", "tick", "only-watcher"]);
  });
});

describe("UX-D: the live Changes tab stages from its section headers", () => {
  const props = (entry: Entry, extra: Record<string, unknown> = {}) => ({
    anchor: "ac-1-0",
    e: entry,
    name: "a.ts",
    root: "C:/r",
    base: null,
    draw: { split: false, wrap: false, spaces: false },
    cache: new Map(),
    ready: readyStore(),
    meter: { watch: () => () => undefined },
    loaded: new Set<string>(),
    onFocusView: () => undefined,
    onGoneView: () => undefined,
    viewedStamp: undefined,
    onToggleViewed: () => undefined,
    folded: true,
    onToggleFold: () => undefined,
    ...extra,
  });
  const html = (entry: Entry, extra?: Record<string, unknown>) => renderToString(createElement(Section, props(entry, extra)));
  it("offers Stage on an unstaged file and Unstage on a staged one", () => {
    expect(html(e({ staged: false }), { onStage: () => undefined })).toContain('aria-label="Stage a.ts"');
    expect(html(e({ staged: true }), { onStage: () => undefined })).toContain('aria-label="Unstage a.ts"');
  });
  it("offers nothing against a base, on a conflicted file, or when the tab gave no stage handler", () => {
    expect(html(e({}))).not.toContain("Stage a.ts");
    expect(html(e({ clash: "UU" }), { onStage: () => undefined })).not.toContain("Stage a.ts");
  });
  it("disables the button while another git action runs", () => {
    const out = html(e({}), { onStage: () => undefined, stageBusy: true });
    expect(out).toMatch(/<button[^>]*disabled[^>]*aria-label="Stage a.ts"|<button[^>]*aria-label="Stage a.ts"[^>]*disabled/);
  });
});
