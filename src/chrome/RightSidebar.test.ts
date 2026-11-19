import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import RightSidebar, { clampLeft, clampWidth, LEFT_MAX, LEFT_MIN, MORE_WIDTH, PanelGuard, pickTab, readLeft, readRight, RIGHT_MIN, RIGHT_TABS, splitTabs, STRIP_PAD, tabWidth } from "./RightSidebar";

// the git workspace's tabs; the folder-workspace tabs (Attached, PR Checks) are T-146-g
const GIT_TABS = RIGHT_TABS.filter((t) => t.id !== "attached" && t.id !== "prchecks");

test("VIEW-056: open by default on Checks (the Explorer and Insights tabs are gone); open, tab and width come back as saved", () => {
  expect(readRight({})).toEqual({ open: true, tab: "checks", width: 300 });
  expect(readRight({ rightSidebarOpen: false, rightSidebarTab: "checks", rightSidebarWidth: 640 })).toEqual({ open: false, tab: "checks", width: 640 });
});

test("VIEW-056: an unknown, old Search, old Explorer or old Insights tab falls back to Checks; a width under the minimum is not used", () => {
  expect(readRight({ rightSidebarTab: "search" }).tab).toBe("checks");
  expect(readRight({ rightSidebarTab: "explorer" }).tab).toBe("checks");
  expect(readRight({ rightSidebarTab: "nope" }).tab).toBe("checks");
  expect(readRight({ rightSidebarWidth: 40 }).width).toBe(300);
  expect(readRight({ rightSidebarWidth: "wide" }).width).toBe(300);
});

test("VIEW-056: a saved width wider than 500 is honoured; the minimum and the workspace's reserved room are kept", () => {
  expect(clampWidth(640, 1916, 297)).toBe(640);
  expect(clampWidth(100, 1916, 297)).toBe(RIGHT_MIN);
  expect(clampWidth(1400, 1416, 297)).toBe(1416 - 297 - 400);
  expect(clampWidth(500, 700, 297)).toBe(300); // T-719: under 900 px the left sidebar is stepped aside, so it doesn't count
  expect(clampWidth(500, 900, 297)).toBe(RIGHT_MIN);
});

test("VIEW-080: a saved Agents tab comes back as Agents", () => {
  expect(readRight({ rightSidebarTab: "agents" }).tab).toBe("agents");
});

test("VIEW-073: a saved Checks tab comes back as Checks", () => {
  expect(readRight({ rightSidebarTab: "checks" }).tab).toBe("checks");
});

test("VIEW-057: the tab strip lists Checks, Attached, PR Checks and History and marks the open one", () => {
  const html = renderToString(createElement(RightSidebar, { tab: "checks", width: 320, max: 600, onTab: () => {}, onWidth: () => {}, children: "body" }));
  expect(html).toMatch(/aria-label="Right sidebar"/);
  expect(html).not.toContain(">Explorer<");
  expect(html).not.toContain(">Insights<");
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Checks/);
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>Attached/);
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>PR Checks/);
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>History/);
  expect(html).toContain("width:320px");
  expect(html).toContain('aria-label="Resize the right sidebar"');
});

test("VIEW-050: the left sidebar width is clamped into range; a width that is not a number keeps the current one", () => {
  expect(readLeft({})).toBe(289);
  expect(readLeft({ leftSidebarWidth: 333.4 })).toBe(333);
  expect(readLeft({ leftSidebarWidth: 9000 })).toBe(LEFT_MAX);
  expect(readLeft({ leftSidebarWidth: -5 })).toBe(LEFT_MIN);
  expect(readLeft({ leftSidebarWidth: "wide" }, 300)).toBe(300);
  expect(readLeft({ leftSidebarWidth: NaN }, 310)).toBe(310);
  expect(clampLeft(LEFT_MAX + 200)).toBe(LEFT_MAX);
});

test("T-146-b: when narrow, the extra tabs move into More and the active tab stays on the strip", () => {
  const all = splitTabs(GIT_TABS, "checks", 320);
  expect([all.shown.map((t) => t.id), all.more]).toEqual([["checks", "agents"], []]);
  // With the Explorer and Insights gone the two git tabs fit even at the minimum width.
  expect(splitTabs(GIT_TABS, "checks", RIGHT_MIN).more).toEqual([]);
  // The edge: exactly enough room shows every tab, one pixel less opens More and the active tab stays.
  const exact = GIT_TABS.reduce((n, t) => n + tabWidth(t.label), 0) + STRIP_PAD;
  expect(splitTabs(GIT_TABS, "checks", exact).more).toEqual([]);
  const narrow = splitTabs(GIT_TABS, "agents", exact - 1);
  expect(narrow.shown.map((t) => t.id)).toEqual(["agents"]);
  expect(narrow.more.map((t) => t.id)).toEqual(["checks"]);
  const used = narrow.shown.reduce((n, t) => n + tabWidth(t.label), 0) + MORE_WIDTH;
  expect(used).toBeLessThanOrEqual(exact - 1);
  // The order on the strip is the tabs' own order, whichever is active (all four tabs, one pixel short).
  const full = RIGHT_TABS.reduce((n, t) => n + tabWidth(t.label), 0) + STRIP_PAD - 1;
  expect(splitTabs(RIGHT_TABS, "agents", full).shown.map((t) => t.id)).toEqual(["checks", "attached", "agents"]);
  expect(splitTabs(RIGHT_TABS, "checks", full).shown.map((t) => t.id)).toEqual(["checks", "attached", "prchecks"]);
  const html = renderToString(createElement(RightSidebar, { tab: "agents", width: exact - 1, max: 600, offered: GIT_TABS.map((t) => t.id), onTab: () => {}, onWidth: () => {}, children: "body" }));
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>History/);
  expect(html).toMatch(/aria-haspopup="menu"[^>]*>More/);
});

test("T-146-b: a remembered tab not offered here opens the first offered tab", () => {
  expect(pickTab("checks", ["agents", "checks"])).toBe("checks");
  expect(pickTab("checks", ["agents", "attached"])).toBe("agents");
  expect(pickTab("checks", [])).toBe(null);
  const html = renderToString(createElement(RightSidebar, { tab: "checks", width: 320, max: 600, offered: ["agents", "attached"], onTab: () => {}, onWidth: () => {}, children: "body" }));
  expect(html).not.toContain("Checks");
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>History/);
});

test("VIEW 056 rest: a panel whose code throws shows a notice with Try again, and the sidebar stays", () => {
  const Broken = () => {
    throw new Error("chunk failed to load");
  };
  const { getDerivedStateFromError, getDerivedStateFromProps } = PanelGuard;
  expect(getDerivedStateFromError(new Error("chunk failed to load"))).toEqual({ failed: "chunk failed to load" });
  expect(getDerivedStateFromProps({ tab: "checks" }, { failed: "x", tab: "agents" })).toEqual({ failed: null, tab: "checks" });
  expect(getDerivedStateFromProps({ tab: "checks" }, { failed: "x", tab: "checks" })).toBe(null);
  const guard = new PanelGuard({ tab: "checks", children: createElement(Broken) });
  guard.state = { failed: "chunk failed to load", tab: "checks" };
  const html = renderToString(guard.render() as never);
  expect(html).toContain('role="alert"');
  expect(html).toContain("This panel stopped working");
  expect(html).toContain("Try again");
});

test("T-644: a saved Source Control, Explorer or Insights tab from an older version opens Checks", () => {
  expect(readRight({ rightSidebarTab: "scm" }).tab).toBe("checks");
  expect(readRight({ rightSidebarTab: "explorer" }).tab).toBe("checks");
  expect(readRight({ rightSidebarTab: "insights" }).tab).toBe("checks");
  expect(RIGHT_TABS.map((t) => t.id)).not.toContain("scm");
  expect(RIGHT_TABS.map((t) => t.id)).not.toContain("insights");
});
