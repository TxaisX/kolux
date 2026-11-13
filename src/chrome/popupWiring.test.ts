// UX lane A: the popups are wired to the shared keyboard helper (dialogFocus.ts, proved in dialogFocus.test.ts).
// renderToString attaches no refs and runs no effects, so the hooks are spied on: each popup must ask for them.
import sidebarSrc from "./RightSidebar.tsx?raw";
import statusSrc from "./StatusBar.tsx?raw";
import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
const useDialogFocus = vi.fn();
const useMenuFocus = vi.fn();
vi.mock("./dialogFocus", () => ({ useDialogFocus: (...a: unknown[]) => useDialogFocus(...a), useMenuFocus: (...a: unknown[]) => useMenuFocus(...a) }));

import StatusBar from "./StatusBar";
import RightSidebar, { tabStep } from "./RightSidebar";

beforeEach(() => {
  useDialogFocus.mockClear();
  useMenuFocus.mockClear();
});

// The confirmation dialog (chrome/Ask) is src/ui's AlertDialog now: its focus and Escape are proved on a real DOM in Ask.test.ts.

test("the status bar's right-click menu and the More tabs menu have the menu keys from Base UI (src/ui), not the hand-rolled helper", () => {
  renderToString(createElement(StatusBar, { terminals: 0 }));
  renderToString(createElement(RightSidebar, { tab: "explorer", width: 300, max: 600, onTab: () => {}, onWidth: () => {}, children: "x" }));
  expect(useMenuFocus).not.toHaveBeenCalled();
  expect(statusSrc).toMatch(/<Menu open=\{menu !== null\} onClose=\{\(\) => setMenu\(null\)\} label="Status bar items" at=\{menu\}/);
  expect(sidebarSrc).toMatch(/<Menu open onClose=\{\(\) => setMenu\(false\)\} label="More tabs" anchor=\{moreButton\}/);
  // statusItems.test.ts opens the status bar's menu on a real DOM.
});

test("chrome.md:15: only the open right-sidebar tab is a tab stop, and the body is its tab panel", () => {
  const html = renderToString(createElement(RightSidebar, { tab: "insights", width: 320, max: 600, onTab: () => {}, onWidth: () => {}, children: "x" }));
  expect(html).toMatch(/tabindex="0"[^>]*role="tab"[^>]*aria-selected="true"[^>]*>Insights</);
  expect(html).toMatch(/tabindex="-1"[^>]*role="tab"[^>]*aria-selected="false"[^>]*>Explorer</);
  expect(html).toContain('role="tabpanel"');
});

test("tabStep: Left and Right wrap around the tabs, Home and End jump, other keys do nothing", () => {
  expect(tabStep(3, 0, "ArrowRight")).toBe(1);
  expect(tabStep(3, 2, "ArrowRight")).toBe(0);
  expect(tabStep(3, 0, "ArrowLeft")).toBe(2);
  expect(tabStep(3, 1, "Home")).toBe(0);
  expect(tabStep(3, 1, "End")).toBe(2);
  expect(tabStep(3, 1, "ArrowDown"), "Down is not a tab key").toBeNull();
  expect(tabStep(3, 1, "a")).toBeNull();
});
