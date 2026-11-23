import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultCopies, rulesBlock, sheetStart } from "../launch/seats";
import { projectMenu } from "./menu";
import { OWN_FOLDERS_FIELD, paletteCreateName, setOwnFolders, singleFolder, worktreesOffNote, WORKTREES_OFF } from "./singleFolder";

// DT-C273: own folders are the default, so each test starts with the switch saved off.
beforeEach(() => setOwnFolders({ [OWN_FOLDERS_FIELD]: false }));
afterEach(() => setOwnFolders({ [OWN_FOLDERS_FIELD]: false }));

describe("T-798 worktrees off", () => {
  it("the palette has nothing to create from typed text while worktrees are off", () => {
    expect(singleFolder()).toBe(true);
    expect(paletteCreateName("fix-login")).toBeNull();
    expect(paletteCreateName("https://github.com/o/r/issues/12")).toBeNull();
  });
  it("with worktrees on, typed text is the trimmed create name and blank text is nothing", () => {
    expect(paletteCreateName("  fix-login ", false)).toBe("fix-login");
    expect(paletteCreateName("   ", false)).toBeNull();
  });
  it("worktree commands say they are off; other commands run", () => {
    expect(worktreesOffNote("workspace.create")).toBe(WORKTREES_OFF);
    expect(worktreesOffNote("palette.open")).toBeNull();
  });
});

// DT-C250: one folder per project is the default; "Own folder for each agent" is a saved choice.
describe("DT-C250 own folder for each agent", () => {
  it("DT-C273: is on unless the setting is saved as false", () => {
    for (const s of [{}, { [OWN_FOLDERS_FIELD]: true }, { [OWN_FOLDERS_FIELD]: "false" }, { [OWN_FOLDERS_FIELD]: 0 }]) {
      setOwnFolders(s);
      expect(singleFolder(), JSON.stringify(s)).toBe(false);
    }
    setOwnFolders({ [OWN_FOLDERS_FIELD]: false });
    expect(singleFolder(), "turning it off brings one folder per project back").toBe(true);
    setOwnFolders({});
    expect(singleFolder(), "a fresh install has own folders").toBe(false);
  });

  it("off: every launch shares the project folder, whatever the last launch chose", () => {
    expect(defaultCopies(true)).toBe("shared");
    expect(sheetStart({ shape: "custom", copies: "separate", seats: [{ agent: "claude", model: "default" }, { agent: "codex", model: "default" }] }, true).copies ?? defaultCopies(true)).toBe("shared");
    expect(projectMenu().map((i) => i.id)).toEqual(["proj:settings", "proj:remove"]);
    expect(worktreesOffNote("workspace.create")).toBe(WORKTREES_OFF);
  });

  it("on: every seat in a Git project starts with a folder each, one seat alone included; a folder outside Git shares", () => {
    setOwnFolders({ [OWN_FOLDERS_FIELD]: true });
    expect(defaultCopies(true), "one seat or many, a Git project gets a fresh folder").toBe("separate");
    expect(defaultCopies(false), "nothing to copy outside Git").toBe("shared");
  });

  it("on: the launch sheet brings back the last launch's choice, and never offers own folders outside Git", () => {
    setOwnFolders({ [OWN_FOLDERS_FIELD]: true });
    const two = [{ agent: "claude", model: "default" }, { agent: "codex", model: "default" }];
    // What the chooser shows: a picked choice, else the default for the live seat count.
    const shown = (last: Parameters<typeof sheetStart>[0], inGit: boolean) => sheetStart(last, inGit).copies ?? defaultCopies(inGit);
    expect(shown({ shape: "custom", copies: "shared", seats: two }, true)).toBe("shared");
    expect(shown({ shape: "custom", copies: "separate", seats: two }, true)).toBe("separate");
    expect(shown({ shape: "custom", copies: "separate", seats: two }, false)).toBe("shared");
    expect(shown(undefined, true), "a first launch gets a folder of its own, one seat or many").toBe("separate");
    // A lineup saved before 2026-11-22 recorded one seat as shared by default: it does not count as a pick.
    expect(shown({ shape: "custom", copies: "shared", seats: [two[0]] }, true), "the old default is not brought back").toBe("separate");
    expect(shown({ shape: "custom", copies: "shared", seats: two }, true), "a picked shared stays picked").toBe("shared");
  });

  it("on: the sidebar's menus, the palette and the worktree commands work again", () => {
    setOwnFolders({ [OWN_FOLDERS_FIELD]: true });
    expect(projectMenu().map((i) => i.id)).toContain("proj:new");
    expect(paletteCreateName(" fix-login ")).toBe("fix-login");
    expect(worktreesOffNote("workspace.create")).toBeNull();
  });

  it("an agent is told which way it is working: in its own folder, or in the shared one", () => {
    const shared = rulesBlock("C:/notes/a.md");
    expect(shared).toContain("in the same project folder");
    expect(shared).toContain("do not make a worktree or a second copy of the project");
    const own = rulesBlock("C:/notes/a.md", true);
    expect(own).toContain("each in a folder of its own");
    expect(own).toContain("Stay inside your own worktree, the folder you started in.");
    expect(own).not.toContain("do not make a worktree");
    for (const text of [shared, own]) {
      expect(text).toContain("Your handoff note is C:/notes/a.md.");
      expect(text).toContain("Do not commit to main.");
    }
  });
});
