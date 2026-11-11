// VIEW-006 / DT-C267: moving between screens. A screen may have a mode (light, dark) of its own; the look is
// put on the window again only when the screen moved to paints in the other mode, never to change nothing.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyAppearance, FIELD, forgetApplied, readAppearance, showScreen, TERMINAL_EVENT } from "./theme";

let sets = 0;
let saves = 0;
let events: string[] = [];
let dataset: Record<string, string> = {};
beforeEach(() => {
  sets = 0;
  saves = 0;
  events = [];
  dataset = {};
  const style = { setProperty: () => void sets++, removeProperty: () => "" };
  vi.stubGlobal("document", { documentElement: { dataset, style, classList: { add: () => {}, remove: () => {} } } });
  vi.stubGlobal("window", { dispatchEvent: (e: { type: string }) => (events.push(e.type), true) });
  vi.stubGlobal("Event", class { constructor(public type: string) {} });
  vi.stubGlobal("localStorage", { setItem: () => void saves++, getItem: () => null });
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => (f(), 0));
  forgetApplied();
  showScreen("terminals", false);
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const state = () => [sets, saves, events.length];

test("DT-C267: moving to a screen that paints in the same mode puts nothing on the window again", () => {
  applyAppearance(readAppearance({ [FIELD.mode]: "dark" }));
  expect(sets, "the look itself is many values").toBeGreaterThan(50);
  expect(events).toEqual([TERMINAL_EVENT]);
  const before = state();
  for (const screen of ["board", "agents", "inbox", "artifacts", "terminals", "board", "terminals"]) showScreen(screen, false);
  expect(state(), "no colour rewritten, nothing saved, no terminal or editor told to take its colours again").toEqual(before);
  expect(dataset.mode).toBe("dark");
});

test("VIEW-006: a screen with a mode of its own still repaints on the way in and on the way out", () => {
  applyAppearance(readAppearance({ [FIELD.mode]: "dark", [FIELD.screens]: { board: "light" } }));
  let before = state();
  showScreen("board", false);
  expect(dataset.mode).toBe("light");
  expect(sets).toBeGreaterThan(before[0]);
  expect(events.length, "terminals and editors follow").toBe(before[2] + 1);
  before = state();
  showScreen("agents", false); // no mode of its own: the app's dark
  expect(dataset.mode).toBe("dark");
  expect(sets).toBeGreaterThan(before[0]);
  before = state();
  showScreen("terminals", false); // dark to dark: nothing
  expect(state()).toEqual(before);
});

test("VIEW-006: the Classic look ignores the Board's and Agents' own modes, so moving there repaints nothing", () => {
  applyAppearance(readAppearance({ [FIELD.mode]: "dark", [FIELD.screens]: { board: "light", agents: "light" } }));
  const before = state();
  showScreen("board", true);
  showScreen("agents", true);
  expect(state()).toEqual(before);
  expect(dataset.mode).toBe("dark");
});

test("VIEW-006: a look applied while a light screen is in front paints light, and the next move back is the only repaint", () => {
  showScreen("board", false);
  applyAppearance(readAppearance({ [FIELD.mode]: "dark", [FIELD.screens]: { board: "light" } }));
  expect(dataset.mode).toBe("light");
  const before = state();
  showScreen("board", false);
  expect(state(), "the same screen again").toEqual(before);
  showScreen("terminals", false);
  expect(dataset.mode).toBe("dark");
  expect(sets).toBeGreaterThan(before[0]);
});

test("DT-C267: the same look put on again writes nothing; a changed look, or the same look on another root, is written", () => {
  const settings = { [FIELD.mode]: "dark", [FIELD.finishTint]: "#4f7fe0" };
  applyAppearance(readAppearance(settings));
  const before = state();
  // what every save of an unrelated setting used to cause: the settings are read again and the look applied again
  for (let i = 0; i < 5; i++) applyAppearance(readAppearance({ ...settings, rightSidebarTab: "insights", leftSidebarOpen: i % 2 === 0 }));
  expect(state(), "no colour rewritten, nothing saved, no terminal or editor told to take its colours again").toEqual(before);
  // a real change of the look is written
  applyAppearance(readAppearance({ ...settings, [FIELD.finishTint]: "#d4a94a" }));
  expect(sets).toBeGreaterThan(before[0]);
  expect(events.length).toBe(before[2] + 1);
  expect(saves).toBe(before[1] + 1);
  // and back again is a change too
  const mid = state();
  applyAppearance(readAppearance(settings));
  expect(sets).toBeGreaterThan(mid[0]);
  // another root has had nothing put on it yet
  let other = 0;
  applyAppearance(readAppearance(settings), { style: { setProperty: () => void other++, removeProperty: () => "" } });
  expect(other).toBeGreaterThan(50);
});

test("DT-C267: a look applied after the system turned dark or light is a different look", () => {
  let systemDark = false;
  vi.stubGlobal("matchMedia", () => ({ matches: systemDark, addEventListener: () => {} }));
  applyAppearance(readAppearance({ [FIELD.mode]: "system" }));
  expect(dataset.mode).toBe("light");
  const before = state();
  applyAppearance(readAppearance({ [FIELD.mode]: "system" }));
  expect(state()).toEqual(before);
  systemDark = true;
  applyAppearance(readAppearance({ [FIELD.mode]: "system" }));
  expect(dataset.mode).toBe("dark");
  expect(sets).toBeGreaterThan(before[0]);
});
