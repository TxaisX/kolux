// UX lane A: small chrome fixes with a pure part: the bell's way back, the failed app menu, and the stylesheet rules
// (read from disk, since a .css import is empty under vitest).
import { expect, test, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { popAppMenu } from "./useChrome";
import { bellTarget } from "./TopBar";

test("chrome.md:20: closing the Inbox goes back to the screen shown before it, not always Terminals", () => {
  expect(bellTarget("terminals", "terminals")).toBe("inbox");
  expect(bellTarget("agents", "agents")).toBe("inbox");
  expect(bellTarget("inbox", "board")).toBe("board");
  expect(bellTarget("inbox", "terminals")).toBe("terminals");
});

test("chrome.md:10: when the app menu cannot open, the click says so instead of doing nothing", async () => {
  const onFail = vi.fn();
  invoke.mockRejectedValueOnce(new Error("no menu"));
  popAppMenu(1, 2, 1, onFail);
  await Promise.resolve();
  await Promise.resolve();
  expect(onFail).toHaveBeenCalledTimes(1);
  invoke.mockResolvedValueOnce(undefined);
  popAppMenu(1, 2, 1, onFail);
  await Promise.resolve();
  await Promise.resolve();
  expect(onFail, "a menu that opened is not reported").toHaveBeenCalledTimes(1);
  invoke.mockRejectedValueOnce(new Error("no menu"));
  expect(() => popAppMenu(1, 2)).not.toThrow(); // no handler: still quiet, as before
});

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
/** The declarations of the first rule whose selector list is exactly `sel`. */
const rule = (sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
  const m = css.match(new RegExp(String.raw`(?:^|\n)\s*${esc}\s*\{([^}]*)\}`));
  expect(m, sel).not.toBeNull();
  return m![1];
};

test("chrome.md:6: a hidden icon button really is hidden", () => {
  expect(rule(".ib[hidden]")).toContain("display: none");
});

test("keyboard.md:12 / visual.md:2: the project row's buttons show when the keyboard lands on them", () => {
  expect(rule(".proj:hover .ib, .proj .ib.on, .proj .ib:focus-visible")).toContain("opacity: 1");
});

test("one keyboard ring for every control without its own focus style; none for the mouse, the terminal or script focus", () => {
  const ring = rule(":where(:focus-visible)");
  expect(ring).toContain("outline: 2px solid var(--line-focus)");
  expect(css, "never :focus, which would show on a mouse click").not.toMatch(/:where\(:focus\)/);
  expect(rule(':where([tabindex="-1"]:focus-visible)')).toContain("outline: none");
  expect(rule(".xterm :focus-visible, .xterm:focus-visible, .xterm-helper-textarea:focus-visible")).toContain("outline: none");
  // zero specificity, and last: a control's own outline (or outline: none) is never overridden by it
  expect(css.indexOf(":where(:focus-visible)")).toBeGreaterThan(css.indexOf(".art-row:focus-visible"));
});

test("chrome.md:9 / destructive.md:18: menus and the dialog scroll inside the window instead of running off it", () => {
  expect(rule(".menu")).toMatch(/max-height: calc\(100vh - 16px\)/);
  expect(rule(".menu")).toContain("overflow-y: auto");
  expect(rule(".ask")).toMatch(/max-height: calc\(100vh - 32px\)/);
  expect(rule(".ask")).toContain("overflow-y: auto");
});

test("chrome.md:17: the app icon choice shows keyboard focus on its label; chrome.md:25: the menu warning uses the warn token", () => {
  expect(rule(".app-icon-pick:has(input:focus-visible)")).toContain("outline: 2px solid var(--line-focus)");
  expect(rule(".menu-hint.warn")).toContain("var(--warn)");
});
