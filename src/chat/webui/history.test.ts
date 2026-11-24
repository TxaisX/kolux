// The chat history column (2026-11-24, the Open WebUI screen): past chats grouped by day, a search over
// their titles, and the rules for when the column is full, a rail of icons, or gone.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatSessionSummary } from "../opencode";
import { COLLAPSED_KEY, NARROW_PX, columnMode, filterSessions, groupSessions, loadCollapsed, saveCollapsed } from "./history";
import { HistoryView } from "./HistoryColumn";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0).getTime();
const NOW = at(2026, 11, 24, 15);
const s = (id: string, title: string, updatedAt: number): ChatSessionSummary => ({ id, title, updatedAt });

const SAMPLE = [
  s("a", "Late tonight", at(2026, 11, 24, 0) + 60_000), // just after midnight today
  s("b", "This morning", at(2026, 11, 24, 8)),
  s("c", "Last night", at(2026, 11, 23, 23)),
  s("d", "Three days ago", at(2026, 11, 21)),
  s("e", "Edge of the week", at(2026, 11, 17, 1)), // seven days before today, still inside
  s("f", "Just outside", at(2026, 11, 16, 23)),
  s("g", "Last month", at(2026, 10, 2)),
];

describe("groupSessions", () => {
  it("puts each chat under Today, Yesterday, Previous 7 days or Older, newest first", () => {
    const groups = groupSessions(SAMPLE, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Previous 7 days", "Older"]);
    expect(groups[0].sessions.map((x) => x.id)).toEqual(["b", "a"]);
    expect(groups[1].sessions.map((x) => x.id)).toEqual(["c"]);
    expect(groups[2].sessions.map((x) => x.id)).toEqual(["d", "e"]);
    expect(groups[3].sessions.map((x) => x.id)).toEqual(["f", "g"]);
  });

  it("leaves out a group with nothing in it", () => {
    expect(groupSessions([s("x", "Only old", at(2026, 1, 5))], NOW).map((g) => g.label)).toEqual(["Older"]);
    expect(groupSessions([], NOW)).toEqual([]);
  });

  it("counts a chat from a minute ago as today even across midnight, by the local calendar day", () => {
    const justAfterMidnight = at(2026, 11, 24, 0) + 5_000;
    expect(groupSessions([s("x", "t", at(2026, 11, 23, 23) + 59 * 60_000)], justAfterMidnight)[0].label).toBe("Yesterday");
    expect(groupSessions([s("x", "t", justAfterMidnight - 1_000)], justAfterMidnight)[0].label).toBe("Today");
  });
});

describe("filterSessions", () => {
  it("keeps chats whose title holds every word typed, in any case", () => {
    expect(filterSessions(SAMPLE, "LAST").map((x) => x.id)).toEqual(["c", "g"]);
    expect(filterSessions(SAMPLE, "last night").map((x) => x.id)).toEqual(["c"]);
    expect(filterSessions(SAMPLE, "  ").length).toBe(SAMPLE.length);
    expect(filterSessions(SAMPLE, "zzz")).toEqual([]);
  });
});

describe("columnMode", () => {
  it("hides the column below 640 px, shows a rail when collapsed and the full column otherwise", () => {
    expect(NARROW_PX).toBe(640);
    expect(columnMode(639, false)).toBe("hidden");
    expect(columnMode(639, true)).toBe("hidden");
    expect(columnMode(640, true)).toBe("rail");
    expect(columnMode(1200, false)).toBe("full");
    expect(columnMode(null, false)).toBe("full");
  });
});

describe("the collapsed state is remembered", () => {
  const fake = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("writes and reads back under its own key", () => {
    const st = fake();
    expect(loadCollapsed(st)).toBe(false);
    saveCollapsed(true, st);
    expect(st.m.get(COLLAPSED_KEY)).toBe("1");
    expect(loadCollapsed(st)).toBe(true);
    saveCollapsed(false, st);
    expect(loadCollapsed(st)).toBe(false);
  });
  it("survives a storage that throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadCollapsed(broken)).toBe(false);
    expect(() => saveCollapsed(true, broken)).not.toThrow();
  });
});

describe("HistoryView", () => {
  const html = (over: Partial<Parameters<typeof HistoryView>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(HistoryView, {
        mode: "full", sessions: SAMPLE, now: NOW, activeId: "b", query: "", asking: null, onQuery: () => {}, onNew: () => {}, onOpen: () => {},
        onAskDelete: () => {}, onCancelDelete: () => {}, onDelete: () => {}, onToggle: () => {}, ...over,
      }),
    );

  it("shows New chat, a search field and the groups, with the open chat marked", () => {
    const out = html();
    expect(out).toContain("New chat");
    expect(out).toContain('aria-label="Search chats"');
    for (const label of ["Today", "Yesterday", "Previous 7 days", "Older"]) expect(out).toContain(label);
    expect(out).toMatch(/aria-current="true"[^>]*>[^<]*<span[^>]*>This morning/);
  });

  it("asks in the page before deleting", () => {
    const out = html({ asking: "c" });
    expect(out).toContain("Delete this chat?");
    expect(out).toContain('aria-label="Delete Last night"');
  });

  it("collapses to a rail with the same two actions as icons", () => {
    const out = html({ mode: "rail" });
    expect(out).toContain('aria-label="New chat"');
    expect(out).toContain('aria-label="Show chat list"');
    expect(out).not.toContain("Previous 7 days");
  });

  it("is not drawn at all when the pane is narrow", () => {
    expect(html({ mode: "hidden" })).toBe("");
  });
});
