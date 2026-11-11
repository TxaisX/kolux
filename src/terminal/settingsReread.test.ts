// Round 3 item 8: every tab opened writes the layout, and the backend says so with "settings-saved". The terminal
// text settings are read again only when a save could have changed them, not for the window's own layout or screen.
import { expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ on: null as null | ((e: { payload: unknown }) => void), reads: 0 }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (_n: string, f: (e: { payload: unknown }) => void) => ((h.on = f), Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string) => (cmd === "get_settings" && h.reads++, Promise.resolve({})) }));

const { followText } = await import("./text");

test("a layout or screen save is not a reason to read the settings again; any other save, or one that says nothing, is", () => {
  followText({});
  h.reads = 0;
  h.on!({ payload: { set: { savedLayout: { panes: [] } }, remove: [] } });
  h.on!({ payload: { set: { lastScreen: "board" }, remove: [] } });
  expect(h.reads).toBe(0);
  h.on!({ payload: { set: { terminalFontSize: 15 }, remove: [] } });
  expect(h.reads).toBe(1);
  h.on!({ payload: null });
  expect(h.reads).toBe(2);
});
