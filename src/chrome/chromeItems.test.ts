import { expect, test } from "vitest";
import { CHROME, chromeShown, windowSummary } from "./chromeItems";
import { describe, it } from "vitest";
import { helpAction, readSynced, REPORT_CRASH_EVENT, MENU_SHORTCUT_IDS, menuBarState, menuEdit, menuScreen, menuSettingFlip, toAccelerator } from "./chromeItems";

test("SET-020: Tasks and Automations buttons show and the app name is hidden by default (DT-A6)", () => {
  expect(CHROME.map((c) => c.id)).toEqual(["titleBarAppName", "tasksButton", "automationsButton", "skillsButton"]);
  expect(chromeShown({}, "tasksButton")).toBe(true);
  expect(chromeShown({}, "automationsButton")).toBe(true);
  expect(chromeShown({}, "titleBarAppName")).toBe(false);
  // SKILL-018: no Skills button on a fresh install; the switch turns it on.
  expect(chromeShown({}, "skillsButton")).toBe(false);
  expect(chromeShown({ skillsButton: true }, "skillsButton")).toBe(true);
  expect(chromeShown({ tasksButton: false, titleBarAppName: true }, "tasksButton")).toBe(false);
  expect(chromeShown({ titleBarAppName: true }, "titleBarAppName")).toBe(true);
  expect(chromeShown({ tasksButton: "no" }, "tasksButton")).toBe(true);
});

test("SET-016: the folded Window & Sidebar header sums up what shows", () => {
  expect(windowSummary({})).toBe("Tasks · Automations · Status bar");
  expect(windowSummary({ titleBarAppName: true, automationsButton: false, statusBarVisible: false })).toBe("App name · Tasks · Status bar hidden");
  expect(windowSummary({ tasksButton: false, automationsButton: false, statusBarHidden: ["memory"] })).toBe("Status bar, 7 of 8 items");
  expect(windowSummary({ skillsButton: true })).toBe("Tasks · Automations · Skills · Status bar");
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
    const st = menuBarState({ statusBarVisible: false, automationsButton: false }, "board", (id) => chords[id]);
    expect(st).toMatchObject({ screen: "board", statusBarVisible: false, tasksButton: true, automationsButton: false, titleBarAppName: false });
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
    expect(menuSettingFlip({ automationsButton: false }, "set.automationsButton")).toEqual(["automationsButton", true]);
    expect(menuSettingFlip({}, "app.settings")).toBeNull();
    expect(menuScreen("screen.board")).toBe("board");
    // T-610 / DT-08: the View menu lists the switcher's four and Floor, so each click shows its screen.
    expect(menuScreen("screen.tower")).toBe("tower");
    expect(menuScreen("screen.floor")).toBe("floor");
    expect(menuScreen("screen.inbox")).toBeNull();
    expect(menuScreen("app.settings")).toBeNull();
  });

  it("T-610 / DT-C68: the Floor item carries no accelerator even with view.floor bound, so on a Mac the menu's key equivalent cannot fire beside the window's toggle of the same chord", () => {
    const st = menuBarState({}, "floor", (id) => (id === "view.floor" ? ["Mod+Alt+F"] : undefined));
    expect(st.screen).toBe("floor");
    expect(MENU_SHORTCUT_IDS).not.toContain("screen.floor");
    expect(st.accelerators).not.toHaveProperty("screen.floor"); // the palette row "Show Floor" is where the chord is printed (reach.test.ts)
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
