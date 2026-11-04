// UX lane A: the popups are wired to the shared keyboard helper (dialogFocus.ts, proved in dialogFocus.test.ts).
// renderToString attaches no refs and runs no effects, so the hooks are spied on: each popup must ask for them.
import { beforeEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
const useDialogFocus = vi.fn();
const useMenuFocus = vi.fn();
vi.mock("./dialogFocus", () => ({ useDialogFocus: (...a: unknown[]) => useDialogFocus(...a), useMenuFocus: (...a: unknown[]) => useMenuFocus(...a) }));

import Ask from "./Ask";
import LayoutStrip from "./LayoutStrip";
import StatusBar from "./StatusBar";
import RightSidebar, { tabStep } from "./RightSidebar";

beforeEach(() => {
  useDialogFocus.mockClear();
  useMenuFocus.mockClear();
});

test("the confirmation dialog traps focus: Escape runs Cancel, and Cancel is the control that gets focus", () => {
  const onCancel = vi.fn();
  renderToString(createElement(Ask, { title: "Delete x?", body: "b", confirm: "Delete", onConfirm: () => {}, onCancel }));
  expect(useDialogFocus).toHaveBeenCalledTimes(1);
  const [, close, initial] = useDialogFocus.mock.calls[0] as [unknown, () => void, () => unknown];
  close();
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(typeof initial).toBe("function");
});

test("the New tab menu takes the menu keys while it is open, and not while it is shut", () => {
  renderToString(createElement(LayoutStrip, { count: 1, onLayout: () => {}, onNewTab: () => {}, open: true }));
  expect(useMenuFocus.mock.calls[useMenuFocus.mock.calls.length - 1]?.[1], "open").toBe(true);
  renderToString(createElement(LayoutStrip, { count: 1, onLayout: () => {}, onNewTab: () => {} }));
  expect(useMenuFocus.mock.calls[useMenuFocus.mock.calls.length - 1]?.[1], "shut").toBe(false);
});

test("the status bar's right-click menu and the More tabs menu use the menu keys too", () => {
  renderToString(createElement(StatusBar, { terminals: 0 }));
  expect(useMenuFocus).toHaveBeenCalledTimes(1);
  renderToString(createElement(RightSidebar, { tab: "explorer", width: 300, max: 600, onTab: () => {}, onWidth: () => {}, children: "x" }));
  expect(useMenuFocus).toHaveBeenCalledTimes(2);
});

test("chrome.md:15: only the open right-sidebar tab is a tab stop, and the body is its tab panel", () => {
  const html = renderToString(createElement(RightSidebar, { tab: "insights", width: 320, max: 600, onTab: () => {}, onWidth: () => {}, children: "x" }));
  expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*tabindex="0"[^>]*>Insights</);
  expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*tabindex="-1"[^>]*>Explorer</);
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
