// C17-R5-01: the first-run "Connect an AI" item must land where a sign-in can actually happen.
// The ACT map is the only route the button has, so it is asserted here rather than through the view.
import { expect, test, vi } from "vitest";
import { OPEN_SETTINGS } from "../settings/pages";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { ACT } from "./Checklist";

test("C17-R5-01: the First steps Connect button opens Settings at Accounts & keys, where signing in lives", () => {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  const seen: unknown[] = [];
  target.addEventListener(OPEN_SETTINGS, (e) => seen.push((e as CustomEvent).detail));
  expect(ACT.connect.label).toBe("Connect");
  ACT.connect.run();
  expect(seen).toEqual([{ page: "accounts", section: "connections" }]);
  vi.unstubAllGlobals();
});
