import { expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readAppearance } from "../theme";
import { AppearanceView, LanguageView, UsagePercentPick } from "./AppearancePage";

test("SET-016: Interface, Terminal and Window & Sidebar, all open at first; fonts sit in Interface", () => {
  const html = renderToString(createElement(AppearanceView, { look: readAppearance({}), onChange: () => {}, windowPart: createElement("p", null, "status switch"), windowSummary: "Status bar shown" }));
  const folds = [...html.matchAll(/<details class="look-fold" data-fold="(\w+)" open="">/g)].map((m) => m[1]);
  expect(folds).toEqual(["interface", "terminal", "window"]);
  expect(html).toContain("Window &amp; Sidebar");
  expect(html).toContain("status switch");
  expect(html.indexOf("App font")).toBeLessThan(html.indexOf('data-fold="terminal"'));
  expect(html).toContain("Editor font");
});

test("SET-023: the Panes card in Terminal holds divider width, a colour per mode and the dim", () => {
  const html = renderToString(createElement(AppearanceView, { look: readAppearance({ paneDividerDark: "#aa3300", paneDim: 70 }), onChange: () => {} }));
  const panes = html.slice(html.indexOf('data-section="panes"'), html.indexOf('data-fold="window"'));
  expect(panes).toContain("Divider width");
  expect(panes).toContain('aria-label="Divider colour, dark mode" value="#aa3300"');
  expect(panes).toContain("Divider colour, light mode");
  expect(panes.match(/>Clear</g)?.length, "only the set colour can be cleared").toBe(1);
  expect(panes).toMatch(/Panes not in focus.*value="70"/);
});

test("SET-017: the Language choice sits in Interface, names each language in its own words, and says what System means", () => {
  const lang = renderToString(createElement(LanguageView, { value: "system", onPick: () => {}, os: ["zh-TW"] }));
  expect(lang).toContain("System (English)");
  for (const n of ["English", "简体中文", "한국어", "日本語", "Español", "Français"]) expect(lang).toContain(n);
  expect(renderToString(createElement(LanguageView, { value: "ja", onPick: () => {}, os: ["ja-JP"] }))).toContain("System (日本語)");
  const html = renderToString(createElement(AppearanceView, { look: readAppearance({}), onChange: () => {}, languagePart: createElement("p", null, "language here") }));
  expect(html.indexOf("language here")).toBeGreaterThan(html.indexOf("Mode"));
  expect(html.indexOf("language here")).toBeLessThan(html.indexOf("Terminal colours"));
});

test("T-263 USAGE-025: the status bar section offers Usage percentages as Used or Remaining", () => {
  const html = renderToString(createElement(UsagePercentPick, { value: "remaining", onPick: () => {} })).replace(/<!-- -->/g, "");
  expect(html).toContain("Usage percentages");
  expect(html).toContain(`<option value="used">Used</option>`);
  expect(html).toContain(`<option value="remaining" selected="">Remaining</option>`);
});

test("UX-audit: the zoom note names the real interface-zoom keys, not the pane zoom ones", () => {
  const html = renderToString(createElement(AppearanceView, { look: readAppearance({}), onChange: () => {} } as never));
  expect(html).toContain("Ctrl+Alt+=");
  expect(html).not.toContain("The zoom shortcuts do the same");
});
