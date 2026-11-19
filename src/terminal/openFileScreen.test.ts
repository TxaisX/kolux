// A file link in an agent reply used to open a tab in the code editor. The editor is gone, so openFile now hands
// the file to the system's default app (the open_path command) and shows the error as a toast if that fails.
// No DOM in this run: the action is called with a bare window state and the wiring is read from the source.
import { beforeEach, expect, test, vi } from "vitest";
import type { WindowState } from "../shell/windowStore";
import type { WindowLate } from "../shell/windowLate";
import pane from "../shell/window/Pane.tsx?raw";
import { paneActions } from "./paneActions";

const calls: Array<[string, unknown]> = [];
let fail: string | null = null;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: unknown) => {
    calls.push([cmd, args]);
    if (fail) throw fail;
    return "ok";
  },
}));

beforeEach(() => {
  calls.length = 0;
  fail = null;
});

function actions() {
  const setToast = vi.fn();
  const setScreen = vi.fn();
  const setPanes = vi.fn();
  const s = { panes: [], activeDir: "C:\\w", focused: 1, setToast, setScreen, setPanes, setFocused: vi.fn() } as unknown as WindowState;
  return { a: paneActions(s, {} as never, {} as never, {} as WindowLate), setToast, setScreen, setPanes };
}

test("C09-R5-01: opening a file hands its path to the open_path command and adds no tab", () => {
  const { a, setPanes, setScreen } = actions();
  a.openFile("C:\\w\\README.md", 12, 3);
  expect(calls).toEqual([["open_path", { path: "C:\\w\\README.md" }]]);
  expect(setPanes).not.toHaveBeenCalled();
  expect(setScreen).not.toHaveBeenCalled();
});

test("C09-R5-01: a file the system cannot open says why in a toast, and does not throw", async () => {
  fail = "no app is set to open this file";
  const { a, setToast } = actions();
  a.openFile("C:\\w\\notes.xyz");
  await new Promise((r) => setTimeout(r, 0));
  expect(setToast).toHaveBeenCalledWith("no app is set to open this file");
});

test("C09-R5-01: a file link in a pane and the check pane's file links both reach openFile", () => {
  expect(pane).toMatch(/t\.kind === "file" \? openFile\(t\.path\)/);
  expect(pane).toContain("onOpenFile={openFile}");
  expect(pane).toContain("onOpenFile={act.openFile}");
});
