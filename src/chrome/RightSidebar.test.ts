import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import RightSidebar, { clampLeft, clampWidth, LEFT_MAX, LEFT_MIN, MORE_WIDTH, PanelGuard, pickTab, readLeft, readRight, RIGHT_MIN, RIGHT_TABS, splitTabs, STRIP_PAD, tabWidth } from "./RightSidebar";

// the git workspace's tabs; the folder-workspace tabs (Attached, PR Checks) are T-146-g
const GIT_TABS = RIGHT_TABS.filter((t) => t.id !== "attached" && t.id !== "prchecks");

test("VIEW-056: open by default on Explorer; open, tab and width come back as saved", () => {
  expect(readRight({})).toEqual({ open: true, tab: "explorer", width: 300 });
  expect(readRight({ rightSidebarOpen: false, rightSidebarTab: "insights", rightSidebarWidth: 640 })).toEqual({ open: false, tab: "insights", width: 640 });
});

test("VIEW-056: an unknown or old Search tab falls back to Explorer; a width under the minimum is not used", () => {
  expect(readRight({ rightSidebarTab: "search" }).tab).toBe("explorer");
  expect(readRight({ rightSidebarTab: "nope" }).tab).toBe("explorer");
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

test("VIEW-057: the tab strip lists Explorer, Insights and Checks and marks the open one", () => {
  const html = renderToString(createElement(RightSidebar, { tab: "insights", width: 320, max: 600, onTab: () => {}, onWidth: () => {}, children: "body" }));
  expect(html).toMatch(/aria-label="Right sidebar"/);
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>Explorer/);
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Insights/);
  expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>Checks/);
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
  const all = splitTabs(GIT_TABS, "insights", 320);
  expect([all.shown.map((t) => t.id), all.more]).toEqual([["explorer", "insights", "checks", "agents"], []]);
  // At the minimum width the three tabs no longer fit: the active one keeps its place.
  const narrow = splitTabs(GIT_TABS, "checks", RIGHT_MIN);
  expect(narrow.shown.map((t) => t.id)).toContain("checks");
  expect(narrow.more.length).toBeGreaterThan(0);
  expect([...narrow.shown, ...narrow.more].map((t) => t.id).sort()).toEqual(["agents", "checks", "explorer", "insights"]);
  const used = narrow.shown.reduce((n, t) => n + tabWidth(t.label), 0) + MORE_WIDTH;
  expect(used).toBeLessThanOrEqual(RIGHT_MIN);
  // The order on the strip is the tabs' own order, whichever is active.
  expect(splitTabs(GIT_TABS, "explorer", RIGHT_MIN).shown.map((t) => t.id)).toEqual(["explorer", "insights"]);
  expect(splitTabs(GIT_TABS, "checks", RIGHT_MIN).shown.map((t) => t.id)).toEqual(["explorer", "checks"]);
  // The edge: exactly enough room shows every tab, one pixel less opens More.
  const exact = GIT_TABS.reduce((n, t) => n + tabWidth(t.label), 0) + STRIP_PAD;
  expect(splitTabs(GIT_TABS, "insights", exact).more).toEqual([]);
  expect(splitTabs(GIT_TABS, "insights", exact - 1).more.length).toBeGreaterThan(0);
  const html = renderToString(createElement(RightSidebar, { tab: "checks", width: RIGHT_MIN, max: 600, onTab: () => {}, onWidth: () => {}, children: "body" }));
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Checks/);
  expect(html).toMatch(/aria-haspopup="menu"[^>]*>More/);
});

test("T-146-b: a remembered tab not offered here opens the first offered tab", () => {
  expect(pickTab("insights", ["explorer", "insights", "checks"])).toBe("insights");
  expect(pickTab("insights", ["explorer", "checks"])).toBe("explorer");
  expect(pickTab("checks", [])).toBe(null);
  const html = renderToString(createElement(RightSidebar, { tab: "insights", width: 320, max: 600, offered: ["explorer", "checks"], onTab: () => {}, onWidth: () => {}, children: "body" }));
  expect(html).not.toContain("Insights");
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Explorer/);
});

test("VIEW 056 rest: a panel whose code throws shows a notice with Try again, and the sidebar stays", () => {
  const Broken = () => {
    throw new Error("chunk failed to load");
  };
  const { getDerivedStateFromError, getDerivedStateFromProps } = PanelGuard;
  expect(getDerivedStateFromError(new Error("chunk failed to load"))).toEqual({ failed: "chunk failed to load" });
  expect(getDerivedStateFromProps({ tab: "insights" }, { failed: "x", tab: "explorer" })).toEqual({ failed: null, tab: "insights" });
  expect(getDerivedStateFromProps({ tab: "insights" }, { failed: "x", tab: "insights" })).toBe(null);
  const guard = new PanelGuard({ tab: "insights", children: createElement(Broken) });
  guard.state = { failed: "chunk failed to load", tab: "insights" };
  const html = renderToString(guard.render() as never);
  expect(html).toContain('role="alert"');
  expect(html).toContain("This panel stopped working");
  expect(html).toContain("Try again");
});

test("T-644: a saved Source Control tab from an older version opens the Explorer; Insights comes back as Insights", () => {
  expect(readRight({ rightSidebarTab: "scm" }).tab).toBe("explorer");
  expect(readRight({ rightSidebarTab: "insights" }).tab).toBe("insights");
  expect(RIGHT_TABS.map((t) => t.id)).not.toContain("scm");
});
