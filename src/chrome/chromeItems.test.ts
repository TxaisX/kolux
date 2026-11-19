import { expect, test } from "vitest";
import { CHROME, chromeShown, windowSummary } from "./chromeItems";
import { describe, it } from "vitest";
import { helpAction, readSynced, REPORT_CRASH_EVENT, MENU_SHORTCUT_IDS, menuBarState, menuEdit, menuScreen, menuSettingFlip, toAccelerator } from "./chromeItems";

test("SET-020: the app name is the one title bar switch, hidden by default (DT-A6)", () => {
  // The Tasks, Automations and Skills buttons went with their screens (2026-11-19 slim-down).
  expect(CHROME.map((c) => c.id)).toEqual(["titleBarAppName"]);
  expect(chromeShown({}, "titleBarAppName")).toBe(false);
  expect(chromeShown({ titleBarAppName: true }, "titleBarAppName")).toBe(true);
  expect(chromeShown({ titleBarAppName: "yes" }, "titleBarAppName")).toBe(false);
});

test("SET-016: the folded Window & Sidebar header sums up what shows", () => {
  expect(windowSummary({})).toBe("Status bar");
  expect(windowSummary({ titleBarAppName: true, statusBarVisible: false })).toBe("App name · Status bar hidden");
  expect(windowSummary({ statusBarHidden: ["memory"] })).toBe("Status bar, 6 of 7 items");
  // A switch saved for a removed button shows nothing.
  expect(windowSummary({ tasksButton: true, automationsButton: true, skillsButton: true })).toBe("Status bar");
});

describe("T-248-a menu bar state (APP-009, SET-020, SET-009)", () => {
  it("spells keymap chords the way the menu does and drops keys the menu cannot name", () => {
    expect(toAccelerator("Mod+Comma")).toBe("CmdOrCtrl+Comma");
    expect(toAccelerator("Mod+Shift+R")).toBe("CmdOrCtrl+Shift+R");
    expect(toAccelerator("Mod+Equal")).toBe("CmdOrCtrl+Equal");
    expect(toAccelerator("Mod+0")).toBe("CmdOrCtrl+0");
    expect(toAccelerator("Cmd+Alt+F12")).toBe("Super+Alt+F12");
    expect(toAccelerator("Mod+Shift+Plus")).toBe("");
    expect(toAccelerator("Hyper+B")).toBe("");
    expect(toAccelerator(undefined)).toBe("");
  });

  it("ticks agree with each Settings switch, defaults included", () => {
    const chords: Record<string, string[]> = { "app.settings": ["Mod+Comma"], "zoom.in": ["Mod+Equal", "Mod+NumpadAdd"], "ui.zoomIn": ["Mod+Alt+Equal"] };
    const st = menuBarState({ statusBarVisible: false }, "terminals", (id) => chords[id]);
    expect(st).toMatchObject({ screen: "terminals", statusBarVisible: false, titleBarAppName: false });
    expect(Object.keys(st).sort()).toEqual(["accelerators", "classic", "screen", "statusBarVisible", "titleBarAppName"]);
    expect(st.accelerators["app.settings"]).toBe("CmdOrCtrl+Comma");
    // The menu zoom is the interface zoom (SET-019): it shows ui.zoom* keys, never the terminal zoom ones (TERM-078).
    expect(st.accelerators["zoom.in"]).toBe("CmdOrCtrl+Alt+Equal");
    expect(st.accelerators["zoom.out"]).toBe("");
    expect(st.classic).toBe(false);
    expect(st.accelerators["sidebar.left.toggle"]).toBe("");
    expect(Object.keys(st.accelerators)).toEqual([...MENU_SHORTCUT_IDS]);
  });

  it("a changed shortcut changes the state the menu is rebuilt from", () => {
    const a = menuBarState({}, "terminals", (id) => (id === "app.settings" ? ["Mod+Comma"] : undefined));
    const b = menuBarState({}, "terminals", (id) => (id === "app.settings" ? ["Mod+Shift+P"] : undefined));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(b.accelerators["app.settings"]).toBe("CmdOrCtrl+Shift+P");
  });

  it("the Classic look is part of the state, so switching the look rebuilds the menu", () => {
    const none = () => undefined;
    expect(menuBarState({}, "terminals", none, true).classic).toBe(true);
    expect(JSON.stringify(menuBarState({}, "terminals", none, true))).not.toBe(JSON.stringify(menuBarState({}, "terminals", none)));
  });

  it("a tick box flips its own field from what is shown now, and screens map back", () => {
    expect(menuSettingFlip({}, "set.statusBarVisible")).toEqual(["statusBarVisible", false]);
    expect(menuSettingFlip({ statusBarVisible: false }, "set.statusBarVisible")).toEqual(["statusBarVisible", true]);
    expect(menuSettingFlip({}, "set.titleBarAppName")).toEqual(["titleBarAppName", true]);
    expect(menuSettingFlip({ titleBarAppName: true }, "set.titleBarAppName")).toEqual(["titleBarAppName", false]);
    // The removed buttons' ticks are gone from the menu, so an old id flips nothing.
    for (const gone of ["set.tasksButton", "set.automationsButton", "set.skillsButton"]) expect(menuSettingFlip({}, gone), gone).toBeNull();
    expect(menuSettingFlip({}, "app.settings")).toBeNull();
    // The View menu lists only the Terminals screen now; the items for every removed screen show nothing.
    expect(menuScreen("screen.terminals")).toBe("terminals");
    for (const gone of ["agents", "board", "tower", "floor", "space", "inbox"]) expect(menuScreen(`screen.${gone}`), gone).toBeNull();
    expect(menuScreen("app.settings")).toBeNull();
  });

  it("DT-C68: the Workspace View items carry no accelerator, so on a Mac the menu's key equivalent cannot fire beside the window's own key for the same chord", () => {
    const st = menuBarState({}, "terminals", (id) => (id === "screen.terminals" ? ["Mod+Alt+F"] : undefined));
    expect(st.screen).toBe("terminals");
    expect(MENU_SHORTCUT_IDS.filter((id) => id.startsWith("screen."))).toEqual([]);
    expect(Object.keys(st.accelerators).filter((id) => id.startsWith("screen."))).toEqual([]);
  });

  it("Edit goes to a focused field, else only Copy and Select All reach the terminal, and Paste waits", () => {
    expect(menuEdit("edit.undo", true)).toEqual({ field: "undo" });
    expect(menuEdit("edit.selectAll", true)).toEqual({ field: "selectAll" });
    expect(menuEdit("edit.copy", false)).toEqual({ terminal: "copy" });
    expect(menuEdit("edit.selectAll", false)).toEqual({ terminal: "selectAll" });
    for (const id of ["edit.undo", "edit.redo", "edit.cut"]) expect(menuEdit(id, false)).toBeNull();
    expect(menuEdit("edit.paste", true)).toBeNull();
    expect(menuEdit("edit.paste", false)).toBeNull();
    expect(menuEdit("zoom.in", true)).toBeNull();
  });
});

describe("T-248-b Help items and the native chord answer (APP-009, SET-010)", () => {
  it("each Help item maps to what the page does for it, anything else to nothing", () => {
    expect(helpAction("help.gettingStarted")).toBe("guide");
    expect(helpAction("help.explore")).toBe("explore");
    expect(helpAction("help.checkUpdates")).toBe("updates");
    expect(helpAction("help.reportCrash")).toBe("crash");
    expect(helpAction("help.nothing")).toBeNull();
    expect(helpAction("toString")).toBeNull();
    expect(REPORT_CRASH_EVENT).toBe("kolux-report-crash");
  });

  it("reads the menu_sync answer and shrugs off a malformed one", () => {
    const ok = { accelerators: ["app.settings"], native: [{ chord: "Mod+Q", name: "Quit Kolux" }] };
    expect(readSynced(ok)).toEqual(ok);
    expect(readSynced(null)).toEqual({ accelerators: [], native: [] });
    expect(readSynced("x")).toEqual({ accelerators: [], native: [] });
    expect(readSynced({ native: [{ chord: 1 }, null, { chord: "Mod+H", name: "Hide Kolux" }] }).native).toEqual([{ chord: "Mod+H", name: "Hide Kolux" }]);
  });
});

// Each View > Appearance tick reads the saved setting and its click flips that same setting, like every
// chrome switch, so the menu route table and CHROME cannot drift apart.
test("SET-020: each View > Appearance chrome tick routes to its saved setting", () => {
  const none = () => undefined;
  expect(menuBarState({}, "terminals", none).titleBarAppName).toBe(false);
  expect(menuBarState({ titleBarAppName: true }, "terminals", none).titleBarAppName).toBe(true);
  for (const c of CHROME) {
    expect(menuSettingFlip({ [c.id]: c.dflt }, `set.${c.id}`)).toEqual([c.id, !c.dflt]);
  }
});
