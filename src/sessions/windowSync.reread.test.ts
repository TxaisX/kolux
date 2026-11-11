// Round 3 item 8: another window's screen is followed from "settings-saved"; a save of only the layout (every tab
// opened) touches no screen, so it costs no settings read. A save that names the screen still moves this window.
import { expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ on: null as null | ((e: { payload: unknown }) => void), reads: 0, saved: "terminals" }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), useRef: (v: unknown) => ({ current: v }), useEffect: (f: () => void) => void f() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (_n: string, f: (e: { payload: unknown }) => void) => ((h.on = f), Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: () => (h.reads++, Promise.resolve({ lastScreen: h.saved })) }));

const { useWindowSync } = await import("./windowSync");

test("a layout-only save is skipped; a screen save is read", async () => {
  useWindowSync({ field: "lastScreen", valid: ["terminals", "board"], screen: "terminals", page: null, ready: true, onScreen: () => {} });
  await Promise.resolve();
  h.reads = 0;
  h.on!({ payload: { set: { savedLayout: { panes: [] } }, remove: [] } });
  expect(h.reads).toBe(0);
  h.on!({ payload: { set: { lastScreen: "board" }, remove: [] } });
  expect(h.reads).toBe(1);
  h.on!({ payload: undefined });
  expect(h.reads).toBe(2);
});
