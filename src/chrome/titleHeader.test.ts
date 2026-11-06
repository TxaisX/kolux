// T-049-c / VIEW-003: Classic wears a sidebar-width title header and no top bar; the New look is
// unchanged. The look is the existing General > Look choice (SET-037), saved through the one
// settings path, so these tests start from a saved settings object, not from a prop.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import TopBar from "./TopBar";
import { chromeLayout, headerWidth, HEADER_MIN, SIDEBAR_GAP } from "./titleHeader";
import { LEFT_DEFAULT, LEFT_MAX, LEFT_MIN, readLeft } from "./RightSidebar";
import { LOOK_FIELD, readLook } from "../settings/general";
import { settingsDiff } from "../settings/saveChanged";

const bar = (classic: boolean, sidebarOpen = true, sidebarWidth?: number) =>
  renderToString(createElement(TopBar, { screen: "terminals", classic, sidebarWidth, onScreen: () => {}, sidebarOpen, onToggleSidebar: () => {}, rightOpen: false, onToggleRight: () => {} }));

test("the look maps to the bar: Classic has the title header and no top bar, New is the top bar", () => {
  expect(chromeLayout(true, true, 289)).toMatchObject({ bar: "titlebar", topBar: false, titleHeader: true, switcher: false });
  expect(chromeLayout(false, true, 289)).toEqual({ bar: "topbar", topBar: true, titleHeader: false, switcher: true, headerWidth: null });
});

test("the header is as wide as the sidebar card plus its gap, at every width the card can have", () => {
  for (const w of [LEFT_MIN, 289, 333, LEFT_MAX]) expect(chromeLayout(true, true, w).headerWidth).toBe(w + SIDEBAR_GAP);
  expect(chromeLayout(true, true).headerWidth).toBe(LEFT_DEFAULT + SIDEBAR_GAP);
  // the card narrower than the controls need never squeezes them; a hidden sidebar leaves the minimum
  expect(headerWidth(true, 100)).toBe(HEADER_MIN);
  expect(headerWidth(false, 400)).toBe(HEADER_MIN);
  expect(headerWidth(true, Number.NaN)).toBe(HEADER_MIN);
  expect(HEADER_MIN).toBeLessThan(LEFT_MIN + SIDEBAR_GAP);
});

test("the header width is the saved sidebar width, so a resize moves it", () => {
  const saved = { leftSidebarWidth: 360.4 };
  expect(chromeLayout(true, true, readLeft(saved)).headerWidth).toBe(360 + SIDEBAR_GAP);
  expect(chromeLayout(true, true, readLeft({ leftSidebarWidth: 9000 })).headerWidth).toBe(LEFT_MAX + SIDEBAR_GAP);
});

test("Classic renders the title header with its left cell at the sidebar width and no top bar or switcher", () => {
  const html = bar(true, true, 333);
  expect(html).toContain('class="titlebar"');
  expect(html).not.toContain('class="topbar"');
  expect(html).not.toContain("switcher");
  expect(html).toContain(`style="width:${333 + SIDEBAR_GAP}px"`);
  expect(html).toContain("data-tauri-drag-region");
  // the window's own controls and the search hint stay reachable (no OS title bar)
  for (const control of ["Minimize", "Maximize", "Close"]) expect(html).toContain(`title="${control}"`);
  expect(html).toContain('class="searchbox"');
  // the header's left controls are all there
  for (const t of ["Kolux", "Terminal zoom", "Hide sidebar", "Forward"]) expect(html).toContain(t);
  expect(bar(true, false, 333)).toContain(`style="width:${HEADER_MIN}px"`);
});

test("the New look renders the top bar exactly as before: switcher, no inline width, no title header", () => {
  const html = bar(false, true, 333);
  expect(html).toContain('class="topbar"');
  expect(html).not.toContain('class="titlebar"');
  for (const label of ["Agents", "Board", "Terminals"]) expect(html).toContain(`>${label}</button>`);
  expect(html).toContain('class="topbar-left"');
  expect(html).not.toContain("width:");
  expect(bar(false)).toBe(bar(false, true, 289));
});

test("the choice persists through the settings path: Classic saved and read back gives the header, New the top bar", () => {
  const before = { defaultAgent: "claude", [LOOK_FIELD]: "new" };
  const after = { ...before, [LOOK_FIELD]: "classic" };
  // the one save sends only the look; reading the saved object back picks the layout
  expect(settingsDiff(before, after)).toEqual({ set: { [LOOK_FIELD]: "classic" }, remove: [] });
  expect(chromeLayout(readLook(after) === "classic", true).titleHeader).toBe(true);
  expect(chromeLayout(readLook(before) === "classic", true).topBar).toBe(true);
  // an older profile that never chose is Classic until the user picks New; a fresh one starts New
  expect(chromeLayout(readLook({ defaultAgent: "claude" }) === "classic", true).titleHeader).toBe(true);
  expect(chromeLayout(readLook({}) === "classic", true).topBar).toBe(true);
});
