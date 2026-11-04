// C13-R1-01: Open in Code and Review changes must leave a full page behind.
import { expect, test, vi } from "vitest";
import type { WindowState } from "../shell/windowStore";
import type { WindowLate } from "../shell/windowLate";
import { paneActions } from "./paneActions";

function state() {
  const setPage = vi.fn();
  const setScreen = vi.fn();
  const setActiveDir = vi.fn();
  const setFocused = vi.fn();
  const setPanes = vi.fn();
  const pane = { key: 5, cwd: "C:\\w", branch: null, agent: "shell", program: null, args: [] };
  const s = { panes: [pane], activeDir: "C:\\w", setPage, setScreen, setActiveDir, setFocused, setPanes, nextKey: { current: 9 } } as unknown as WindowState;
  const late = { setReveal: vi.fn() } as unknown as WindowLate;
  const a = paneActions(s, {} as never, {} as never, { prRows: [] as never }, late);
  return { a, setPage, setScreen, setPanes };
}

test("C13-R1-01: Open in Code clears the full page before showing Terminals", () => {
  const { a, setPage, setScreen } = state();
  a.openPane(5);
  expect(setScreen).toHaveBeenCalledWith("terminals");
  expect(setPage).toHaveBeenCalledWith(null);
});

test("C13-R1-01: Review changes on a new tab clears the full page", () => {
  const { a, setPage, setScreen, setPanes } = state();
  a.reviewChanges(5);
  expect(setPanes).toHaveBeenCalled();
  expect(setScreen).toHaveBeenCalledWith("terminals");
  expect(setPage).toHaveBeenCalledWith(null);
});
