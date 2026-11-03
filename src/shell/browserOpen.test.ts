// UX lane A (shell.md row 3): a page asked for in the built-in browser brings the Terminals screen back.
import { expect, test, vi } from "vitest";
import { OPEN_IN_BROWSER } from "../browser/openIn";
import { watchBrowserOpen } from "./browserOpen";
import windowView from "./WindowView.tsx?raw";

test("the request to open a page runs the switch, and the stop removes the same listener", () => {
  const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const show = vi.fn();
  const stop = watchBrowserOpen(target, show);
  expect(target.addEventListener).toHaveBeenCalledWith(OPEN_IN_BROWSER, show);
  stop();
  expect(target.removeEventListener).toHaveBeenCalledWith(OPEN_IN_BROWSER, show);
});

test("the window installs the watch with its screen and page setters", () => {
  expect(windowView).toMatch(/useShowTerminalsOnBrowserOpen\(setScreen, setPage\)/);
});
