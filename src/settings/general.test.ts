import { expect, test, vi } from "vitest";
import { durableOnly, lastWriter, readLook, saveLayout, savedFirst, shownFirst, stampLook, startScreen } from "./general";
import type { SavedLayout } from "../terminal/layout";

test("VIEW-107: a failed layout save is retried once, then only the durable part is saved", async () => {
  const l: SavedLayout = { panes: [{ key: 1, cwd: "C:/a", branch: null, agent: "shell", program: null, args: [] }], activeTab: { 0: 1 }, focused: 1, activeDir: "C:/a", stacked: { "C:/a": true } };
  const ok = vi.fn(async () => {});
  expect(await saveLayout(l, ok, 0)).toBe("saved");
  expect(ok).toHaveBeenCalledTimes(1);
  const once = vi.fn().mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
  expect(await saveLayout(l, once, 0)).toBe("retried");
  expect(once).toHaveBeenCalledTimes(2);
  const twice = vi.fn().mockRejectedValueOnce(new Error("busy")).mockRejectedValueOnce(new Error("busy")).mockResolvedValue(undefined);
  expect(await saveLayout(l, twice, 0)).toBe("durable");
  expect(twice).toHaveBeenLastCalledWith(durableOnly(l));
  expect(durableOnly(l)).toEqual({ panes: l.panes, activeTab: {}, focused: 0, activeDir: "C:/a", stacked: {} });
  const never = vi.fn(async () => {
    throw new Error("unreadable");
  });
  await expect(saveLayout(l, never, 0)).rejects.toThrow("unreadable");
  expect(never).toHaveBeenCalledTimes(3);
});

test("a fresh profile is New, an existing one without the choice is Classic", () => {
  expect(readLook({})).toBe("new");
  expect(readLook({ defaultAgent: "claude" })).toBe("classic");
  expect(readLook({ defaultAgent: "claude", uiLook: "new" })).toBe("new");
  expect(readLook({ uiLook: "fancy", x: 1 })).toBe("classic");
});

test("the look is written down once, so a fresh profile stays New; T-418: a missing mode is written Dark", () => {
  expect(stampLook({})).toEqual({ uiLook: "new", appearanceMode: "dark" });
  expect(stampLook({ a: 1 })).toEqual({ a: 1, uiLook: "classic", appearanceMode: "dark" });
  expect(stampLook({ uiLook: "new" })).toEqual({ uiLook: "new", appearanceMode: "dark" });
  expect(stampLook({ uiLook: "new", appearanceMode: "dim" })).toEqual({ uiLook: "new", appearanceMode: "dark" });
  expect(stampLook({ uiLook: "classic", appearanceMode: "system" })).toBeNull();
  expect(stampLook({ uiLook: "new", appearanceMode: "light" })).toBeNull();
});

test("the first screen is Terminals under New and Classic (the other screens are gone)", () => {
  expect(startScreen({ uiLook: "new", firstScreen: "agents" })).toBe("terminals"); // the Agents screen is gone
  expect(startScreen({ uiLook: "classic", firstScreen: "agents" })).toBe("terminals");
  expect(savedFirst({ firstScreen: "elsewhere" })).toBe("terminals");
  // VIEW-001 as amended for the trial (DT-C40): a New profile that never chose a screen opens on Terminals; Classic stays on Terminals.
  expect(startScreen({ uiLook: "new" })).toBe("terminals");
  expect(startScreen({ uiLook: "new", firstScreen: "terminals" })).toBe("terminals");
  expect(startScreen({ uiLook: "classic" })).toBe("terminals");
});

test("C17-R1-01: the first screen the page shows is one the start honours; a screen the app no longer has falls back to Terminals", () => {
  for (const gone of ["board", "tower", "floor", "space", "inbox"]) {
    expect(savedFirst({ firstScreen: gone }), gone).toBe("terminals");
    expect(startScreen({ uiLook: "new", firstScreen: gone, lastScreen: gone }), gone).toBe("terminals");
    expect(startScreen({ uiLook: "classic", firstScreen: gone, lastScreen: gone }), gone).toBe("terminals");
  }
  expect(shownFirst({ firstScreen: "agents" }, false)).toBe("terminals"); // the Agents screen is gone
  expect(shownFirst({ firstScreen: "agents" }, true)).toBe("terminals"); // unchanged Classic clamp
});

test("VIEW-005: the screen left at quit comes back, an unknown one falls back", () => {
  expect(startScreen({ uiLook: "new", firstScreen: "terminals", lastScreen: "terminals" })).toBe("terminals");
  for (const gone of ["agents", "artifacts", "inbox", "board", "tower"]) {
    expect(startScreen({ uiLook: "new", lastScreen: gone }), gone).toBe("terminals"); // a removed screen falls back
    expect(startScreen({ uiLook: "classic", lastScreen: gone }), gone).toBe("terminals");
  }
  expect(startScreen({ uiLook: "new", firstScreen: "agents", lastScreen: "settings" })).toBe("terminals");
  expect(startScreen({ uiLook: "new", lastScreen: 7 })).toBe("terminals"); // DT-C40
});

test("VIEW-005: quick switches are one write, a close flushes the last one", () => {
  vi.useFakeTimers();
  const writes: string[] = [];
  const w = lastWriter((v: string) => writes.push(v), 400);
  w.set("board");
  w.set("agents");
  vi.advanceTimersByTime(399);
  expect(writes).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(writes).toEqual(["agents"]);
  w.set("inbox");
  w.flush();
  w.flush();
  expect(writes).toEqual(["agents", "inbox"]);
  vi.useRealTimers();
});

test("VIEW-011: a Skills screen open at quit falls back now that the screen is gone", () => {
  expect(startScreen({ uiLook: "new", lastScreen: "skills" })).toBe("terminals");
  expect(startScreen({ uiLook: "classic", lastScreen: "skills" })).toBe("terminals");
});
