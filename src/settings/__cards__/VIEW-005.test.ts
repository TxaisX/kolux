// VIEW-005 acceptance, the read half: what the window opens on given the settings it read at start.
// The write half (App.tsx:1490 effect, screenWriter) is inline in App and is a LIVE check.
import { expect, test } from "vitest";
import { startScreen } from "../general";

test("box 1 (restore half): a saved Routing or Tasks page (both gone) is ignored, and the window still opens on Terminals", () => {
  expect(startScreen({ openPage: "routing", lastScreen: "terminals" })).toBe("terminals");
  expect(startScreen({ openPage: "tasks", uiLook: "classic" })).toBe("terminals");
});

test("box 2 (restore half): settings that read as defaults ({}), or an unknown saved page or screen, open on the terminal workspace with no page", () => {
  expect(startScreen({})).toBe("terminals");
  expect(startScreen({ lastScreen: "nowhere" })).toBe("terminals");
  expect(startScreen({ lastScreen: 7 })).toBe("terminals");
});
