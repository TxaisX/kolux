// sim-a 6: the left sidebar hidden at quit comes back hidden, as the right panel's choice does.
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const { LEFT_OPEN_KEY, leftOpenAtStart } = await import("./windowStore");

test("the saved left sidebar state is read at start; nothing saved means shown", () => {
  expect(LEFT_OPEN_KEY).toBe("leftSidebarOpen");
  expect(leftOpenAtStart({ leftSidebarOpen: false })).toBe(false);
  expect(leftOpenAtStart({ leftSidebarOpen: true })).toBe(true);
  expect(leftOpenAtStart({})).toBe(true);
  expect(leftOpenAtStart({ leftSidebarOpen: "no" })).toBe(true); // anything odd reads as shown
});
