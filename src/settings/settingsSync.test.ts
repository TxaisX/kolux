import { expect, test } from "vitest";
import { adoptStored, applyBroadcast, createLoadRace, readBroadcast, withoutSecrets } from "./settingsSync";
import { tidyBypassList, tidySettings } from "./tidy";

test("SET-035: a broadcast from another window changes the keys it names and removes the ones it lists", () => {
  const b = readBroadcast({ set: { terminalFont: "Cascadia Code" }, remove: ["zoom"] });
  expect(b).toEqual({ set: { terminalFont: "Cascadia Code" }, remove: ["zoom"] });
  expect(applyBroadcast({ terminalFont: "Consolas", zoom: 1.2, theme: "dark" }, b!)).toEqual({ terminalFont: "Cascadia Code", theme: "dark" });
});

test("SET-035: a broadcast with no change in it means read again; secrets in one are dropped", () => {
  expect(readBroadcast(null)).toBeNull();
  expect(readBroadcast(undefined)).toBeNull();
  expect(readBroadcast("saved")).toBeNull();
  expect(readBroadcast({ set: [1] })).toBeNull();
  const b = readBroadcast({ set: { theme: "dark", xaiApiKey: "k", httpProxy: "http://u:p@h:1" }, remove: ["claudeOauthToken", "zoom"] });
  expect(JSON.stringify(b)).not.toMatch(/xaiApiKey|httpProxy|claudeOauthToken|u:p@h/);
  expect(b).toEqual({ set: { theme: "dark" }, remove: ["zoom"] });
  expect(withoutSecrets({ a: 1, minimaxCookie: "c" })).toEqual({ a: 1 });
});

test("SET-035: a change made while settings are still loading wins over the load that arrives afterwards", () => {
  const race = createLoadRace();
  race.change({ terminalFont: "Fira Code" }); // the user switches before the first read comes back
  race.change({ zoom: 1.5 });
  expect(race.loaded({ terminalFont: "Consolas", zoom: 1, theme: "dark", xaiApiKey: "k" })).toEqual({ terminalFont: "Fira Code", zoom: 1.5, theme: "dark" });
  race.change({ zoom: 9 }); // after the load, later changes are the page's own business
  expect(race.loaded({ zoom: 1 })).toEqual({ zoom: 1 }); // a later re-read is plain
});

test("SET-035: after a save the window takes the stored value, and a failed save never reverses another setting", () => {
  const current = { terminalLineHeight: 1.234, theme: "light", terminalFont: "Fira Code" };
  // The save stored the line height tidied; the theme was changed by another window meanwhile.
  expect(adoptStored(current, { terminalLineHeight: 1.25, theme: "dark" }, { terminalLineHeight: 1.234 })).toEqual({ terminalLineHeight: 1.25, theme: "light", terminalFont: "Fira Code" });
  // The font save failed: only the font goes back to what is stored; the theme that saved fine stays.
  expect(adoptStored(current, { terminalFont: "Consolas", theme: "light" }, { terminalFont: "Fira Code" })).toEqual({ terminalLineHeight: 1.234, theme: "light", terminalFont: "Consolas" });
  // A key that is not stored at all disappears.
  expect(adoptStored({ a: 1, b: 2 }, { b: 2 }, { a: 1 })).toEqual({ b: 2 });
});

test("SET-035: scrollback rows and line height are tidied on save and on load, older formats converted", () => {
  expect(tidySettings({ terminalScrollback: "5000" }).terminalScrollback).toBe(5000);
  expect(tidySettings({ terminalScrollback: 250000 }).terminalScrollback).toBe(100000);
  expect(tidySettings({ terminalScrollback: -4 }).terminalScrollback).toBe(0);
  expect(tidySettings({ terminalScrollback: "lots" }).terminalScrollback).toBe(1000);
  expect(tidySettings({ terminalScrollback: 1500.7 }).terminalScrollback).toBe(1501);
  expect(tidySettings({ terminalLineHeight: "1.2" }).terminalLineHeight).toBe(1.2);
  expect(tidySettings({ terminalLineHeight: 5 }).terminalLineHeight).toBe(2);
  expect(tidySettings({ terminalLineHeight: 0.2 }).terminalLineHeight).toBe(1);
  expect(tidySettings({ terminalLineHeight: 1.234 }).terminalLineHeight).toBe(1.25);
});

test("SET-035: custom schemes lose bad entries and repeats; the proxy bypass list and app icon are tidied", () => {
  const out = tidySettings({
    terminalCustomSchemes: [{ name: "Night", background: "#101010", foreground: "#EEEEEE" }, { name: "night", background: "#000000", foreground: "#ffffff" }, { name: "bad", background: "red" }, 7],
  });
  expect(out.terminalCustomSchemes).toEqual([{ name: "Night", background: "#101010", foreground: "#eeeeee" }]);
  expect(tidySettings({ httpProxyBypass: "Localhost, 10.0.0.0/8;localhost  *.corp.example bad host!" }).httpProxyBypass).toEqual(["localhost", "10.0.0.0/8", "*.corp.example", "bad"]);
  expect(tidyBypassList(["A.example", "a.example", 4, "!!"])).toEqual(["a.example"]);
  expect(tidySettings({ appIcon: "Blue" }).appIcon).toBe("blue");
  expect(tidySettings({ appIcon: "neon" }).appIcon).toBe("classic");
});

test("SET-035: tidying touches only keys that are present and returns the same object when nothing changes", () => {
  const s = { terminalScrollback: 2000, theme: "dark" };
  expect(tidySettings(s)).toBe(s);
  expect(Object.keys(tidySettings({ theme: "dark" }))).toEqual(["theme"]);
});

test("a save of only the window's own state (the pane layout, the screen in front) is told apart, so account and key readers skip it", async () => {
  const { onlyWindowState } = await import("./settingsSync");
  expect(onlyWindowState({ set: { savedLayout: { panes: [] } }, remove: [] })).toBe(true);
  expect(onlyWindowState({ set: { lastScreen: "board", savedLayout: {} }, remove: [] })).toBe(true);
  expect(onlyWindowState({ set: { savedLayout: {}, claudeKeyMode: true }, remove: [] })).toBe(false);
  expect(onlyWindowState({ set: {}, remove: ["claudeOauthToken"] })).toBe(false); // a secret dropped: read again
  expect(onlyWindowState({ set: {}, remove: [] })).toBe(false);
  expect(onlyWindowState(null)).toBe(false);
});
