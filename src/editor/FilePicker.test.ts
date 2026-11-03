import { describe, expect, it } from "vitest";
import { quickOpenList, rank, scrollActive } from "./FilePicker";

describe("Quick Open ranking (EDIT-036)", () => {
  const paths = ["src/panel/index.ts", "src/panel/util.ts", "docs/sidepanel.md", "src/panel.tsx", "src/pa-nel.ts", "readme.md"];
  const ranked = (q: string) => rank(paths, q).map((i) => paths[i]);

  it("puts name hits before files that only sit in a matching folder", () => {
    expect(ranked("panel")).toEqual(["src/panel.tsx", "docs/sidepanel.md", "src/pa-nel.ts", "src/panel/util.ts", "src/panel/index.ts"]);
  });
  it("keeps list order for an empty query and stops at the limit", () => {
    expect(ranked("")).toEqual(paths);
    expect(rank(paths, "", 2)).toEqual([0, 1]);
    expect(rank(Array.from({ length: 80 }, (_, i) => `f${i}.ts`), "f")).toHaveLength(50);
  });
  it("ignores spaces and backslashes in the query", () => {
    expect(ranked("src\\panel.t sx")).toEqual(["src/panel.tsx"]);
  });
  it("turns relative names into native full paths and explains a missing ripgrep", () => {
    const l = quickOpenList("C:\\r\\", { files: ["a/b.ts"], capped: true, source: "git", rgMissing: true });
    expect(l.items).toEqual([{ path: "C:\\r\\a\\b.ts" }]);
    expect(l.capped).toBe(true);
    expect(l.note).toMatch(/ripgrep is not installed, so these are git's files only/);
    expect(quickOpenList("/r", { files: ["x"], capped: false, source: "rg", rgMissing: false })).toEqual({ items: [{ path: "/r/x" }], capped: false, note: undefined });
  });
});

describe("picker keyboard scrolling", () => {
  it("scrolls the active option just into view", () => {
    const seen: unknown[] = [];
    const option = { scrollIntoView: (o: unknown) => seen.push(o) };
    scrollActive({ querySelector: (sel: string) => (sel === '[aria-selected="true"]' ? option : null) } as never);
    expect(seen).toEqual([{ block: "nearest" }]);
  });
  it("does nothing when there is no list or no active option", () => {
    expect(() => scrollActive(null)).not.toThrow();
    expect(() => scrollActive({ querySelector: () => null } as never)).not.toThrow();
  });
});
