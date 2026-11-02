// The names Help, the palette, recovery and the status bar import from update/UpdateCenter keep working, and
// importing them does not load the update screen (UpdateCenterView.tsx).
import { afterEach, expect, test, vi } from "vitest";
import * as door from "./UpdateCenter";
import * as bus from "./bus";

afterEach(() => vi.unstubAllGlobals());

test("UpdateCenter.tsx still exports the old names, the very same ones as bus.ts", () => {
  expect(door.requestUpdateCheck).toBe(bus.requestUpdateCheck);
  expect(door.BAR_EVENT).toBe("kolux-update-bar");
  expect(door.SHOW_EVENT).toBe("kolux-update-show");
  expect(door.currentBar).toBe(bus.currentBar);
  expect(door.currentBar()).toBeNull();
});

test("requestUpdateCheck sends the event the update screen listens for", () => {
  const seen: string[] = [];
  vi.stubGlobal("window", { dispatchEvent: (e: Event) => (seen.push(e.type), true) });
  door.requestUpdateCheck();
  expect(seen).toEqual(["kolux-check-updates"]);
  expect(bus.CHECK_EVENT).toBe("kolux-check-updates");
});
