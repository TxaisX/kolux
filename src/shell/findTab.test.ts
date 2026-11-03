import { describe, expect, it, vi } from "vitest";
import { isTabRow, onTabSearch, openTabSearch, tabMatches, tabSearcher, type TabEntry } from "./findTab";
import dialogsSource from "./window/Dialogs.tsx?raw";

const tab = (label: string, hint?: string): TabEntry => ({ label, hint, run: () => {} });

describe("TERM-053 mount and trigger", () => {
  it("the trigger opens whatever the box mounted on the same target, and stops after the box unmounts", () => {
    const target = new EventTarget();
    const open = vi.fn();
    const off = onTabSearch(open, target);
    openTabSearch(target);
    expect(open).toHaveBeenCalledTimes(1);
    off();
    openTabSearch(target);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe("TERM-053 results", () => {
  const tabs = [tab("claude-1", "feature-x"), tab("Build log", "main"), tab("notes.md", "docs")];
  it("typing part of a tab name lists that tab", () => {
    expect(tabMatches("build", tabs).map((t) => t.label)).toEqual(["Build log"]);
  });
  it("a query matching only the worktree name lists no tabs", () => {
    expect(tabMatches("feature-x", tabs)).toEqual([]);
    expect(tabMatches("docs", tabs)).toEqual([]);
  });
  it("nothing typed lists nothing", () => {
    expect(tabMatches("  ", tabs)).toEqual([]);
  });
  it("a late answer for an older query is dropped", async () => {
    const shown: string[][] = [];
    let release: (t: TabEntry[]) => void = () => {};
    const slow = new Promise<TabEntry[]>((r) => (release = r));
    let call = 0;
    const search = tabSearcher(() => (++call === 1 ? slow : tabs), (rows) => shown.push(rows.map((r) => r.label)));
    const first = search("c");
    await search("notes");
    release(tabs);
    await first;
    expect(shown).toEqual([["notes.md"]]);
  });
});

it("palette.md:13: the tab search lists browser pages as well as terminal tabs, and nothing else", () => {
  expect(isTabRow({ section: "Open tabs" })).toBe(true);
  expect(isTabRow({ section: "Browser pages" })).toBe(true);
  expect(isTabRow({ section: "Projects" })).toBe(false);
  expect(dialogsSource).toContain("<TabSearch tabs={() => paletteItems().filter(isTabRow)} />");
});
