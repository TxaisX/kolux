// C16-R4-01: the checklist's one action button must land where an AI is actually connected. The
// connect cards (and the `aiConnected` milestone that ticks this item) live on Accounts & keys, in
// the `connections` section; the Agents page only holds switches for agents that are not signed in
// yet. There is no DOM renderer in this repo, so the action map is driven directly.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OPEN_SETTINGS, type SettingsTarget } from "../settings/pages";

let win: EventTarget;
beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal("window", win);
});
afterEach(() => vi.unstubAllGlobals());

test("the checklist Connect opens the page that can connect an AI (C16-R4-01)", async () => {
  const { ACT } = await import("./Checklist");
  const seen: SettingsTarget[] = [];
  win.addEventListener(OPEN_SETTINGS, (e) => seen.push((e as CustomEvent<SettingsTarget>).detail));
  ACT.connect.run();
  expect(seen).toEqual([{ page: "accounts", section: "connections" }]);
});
