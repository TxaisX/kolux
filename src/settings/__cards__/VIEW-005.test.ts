// VIEW-005 acceptance, the read half: what the window opens on given the settings it read at start.
// The write half (App.tsx:1490 effect, screenWriter) is inline in App and is a LIVE check.
import { expect, test } from "vitest";
import { openPageAt, startScreen } from "../general";

test("box 1 (restore half): openPage routing is read back as the Routing page, whichever screen was saved; a saved Tasks page (gone) opens nothing", () => {
  expect(openPageAt({ openPage: "routing", lastScreen: "terminals" })).toBe("routing");
  expect(openPageAt({ openPage: "routing", uiLook: "classic" })).toBe("routing");
  expect(startScreen({ openPage: "routing", lastScreen: "terminals" })).toBe("terminals");
  expect(openPageAt({ openPage: "tasks", lastScreen: "terminals" })).toBeNull();
});

test("box 2 (restore half): settings that read as defaults ({}), or an unknown saved page or screen, open on the terminal workspace with no page", () => {
  expect(startScreen({})).toBe("terminals");
  expect(openPageAt({})).toBeNull();
  expect(startScreen({ lastScreen: "nowhere" })).toBe("terminals");
  expect(openPageAt({ openPage: "nowhere" })).toBeNull();
  expect(startScreen({ lastScreen: 7 })).toBe("terminals");
});
