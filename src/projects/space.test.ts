import { describe, expect, it } from "vitest";
import { folderResult, worstOf, attachedTo } from "./folderWorkspace";
import { deletable, formatBytes, formatCount, reclaimableBytes, searchRows, selectedForDelete, sortRows, treemap, visibleRows, ageOf, type SpaceRow } from "./space";

const row = (path: string, bytes: number, o: Partial<SpaceRow> = {}): SpaceRow => ({ path, branch: path.split("/").pop() ?? null, isMain: false, size: { bytes, files: bytes / 10, incomplete: false }, modified: 1_000_000, reclaimable: true, ...o });
const rows = [row("C:/repo", 5000, { isMain: true, reclaimable: false, branch: "main" }), row("C:/ws/login", 3000, { modified: 900_000 }), row("C:/ws/docs", 9000, { modified: 950_000 }), row("C:/ws/fix", 100)];
const none = new Set<string>();

describe("space formatting", () => {
  it("reads sizes and counts for people", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatBytes(5 * 1024 ** 3, true)).toBe("5 GB+");
    expect(formatCount(12345)).toBe("12,345");
    expect(formatCount(9, true)).toBe("9+");
  });
  it("shows an age and nothing for an unknown one", () => {
    expect(ageOf(row("C:/a", 1, { modified: 0 }), 5_000_000_000)).toBe("");
    expect(ageOf(row("C:/a", 1, { modified: 1_000_000 }), 1_000_000_000 + 3 * 86400 * 1000)).toBe("3d");
  });
});

describe("space table", () => {
  it("sorts biggest first and searches by branch", () => {
    expect(sortRows(rows, "size").map((r) => r.branch)).toEqual(["docs", "main", "login", "fix"]);
    expect(sortRows(rows, "age", 2_000_000).map((r) => r.branch)[0]).toBe("login");
    expect(searchRows(rows, "LOG").map((r) => r.branch)).toEqual(["login"]);
  });
  it("counts reclaimable space for linked worktrees only", () => {
    expect(reclaimableBytes(rows)).toBe(12100);
  });
  it("filters to what can be deleted; one in use never can", () => {
    const active = new Set(["C:/ws/docs"]);
    expect(deletable(rows[0], none)).toBe(false);
    expect(deletable(rows[2], active)).toBe(false);
    expect(visibleRows(rows, { query: "", sort: "size", deletableOnly: true, active }).map((r) => r.branch)).toEqual(["login", "fix"]);
  });
  it("deletes only the deletable of a mixed selection and says why for the rest", () => {
    const active = new Set(["C:/ws/docs"]);
    const r = selectedForDelete(["C:/ws/login", "C:/ws/docs", "C:/repo", "C:/ws/login", "C:/gone"], rows, active);
    expect(r.go.map((x) => x.path)).toEqual(["C:/ws/login"]);
    expect(r.skipped.map((s) => s.path)).toEqual(["C:/ws/docs", "C:/repo", "C:/gone"]);
    expect(r.skipped[0].why).toContain("in use");
  });
});

describe("treemap", () => {
  it("fills the square and folds the tail into one block", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ label: `w${i}`, bytes: 1000 - i * 10 }));
    const t = treemap(items, 5);
    expect(t.blocks).toHaveLength(6);
    expect(t.omitted).toBe(25);
    expect(t.blocks[5].label).toBe("25 more");
    expect(Math.round(t.blocks.reduce((a, b) => a + b.w * b.h, 0))).toBe(10000);
    expect(treemap([{ label: "a", bytes: 0 }]).blocks).toEqual([]);
  });
});

describe("folder workspaces", () => {
  const all = [{ path: "C:/f/a", parent: "C:/f" }, { path: "C:/f/a/b", parent: "C:/f/a" }, { path: "C:/other", parent: null }];
  it("finds nested worktrees through any depth", () => {
    expect(attachedTo("C:/f", all).map((w) => w.path)).toEqual(["C:/f/a", "C:/f/a/b"]);
    expect(attachedTo("C:/f", [{ path: "C:/f", parent: "C:/f/a" }, { path: "C:/f/a", parent: "C:/f" }]).map((w) => w.path)).toEqual(["C:/f/a"]);
  });
  it("shows failing over pending over passing and leaves dismissed pull requests out", () => {
    const ok = { checks: [{ outcome: "passed" as const }] };
    const bad = { checks: [{ outcome: "failed" as const }] };
    const wait = { checks: [{ outcome: "running" as const }] };
    expect(worstOf([ok, bad])).toBe("failing");
    expect(worstOf([ok, wait])).toBe("pending");
    expect(worstOf([ok])).toBe("passing");
    expect(worstOf([{ ...bad, dismissed: true }, ok])).toBe("passing");
    expect(worstOf([])).toBeNull();
    expect(folderResult("C:/f", all, (p) => (p === "C:/f/a/b" ? bad : ok))).toBe("failing");
  });
});
