import { afterEach, describe, expect, it } from "vitest";
import { defaultCopies, rulesBlock, sheetStart } from "../launch/seats";
import { projectMenu } from "./menu";
import { OWN_FOLDERS_FIELD, paletteCreateName, setOwnFolders, singleFolder, worktreesOffNote, WORKTREES_OFF } from "./singleFolder";

afterEach(() => setOwnFolders({}));

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
  it("is off unless the setting is saved as true", () => {
    for (const s of [{}, { [OWN_FOLDERS_FIELD]: false }, { [OWN_FOLDERS_FIELD]: "true" }, { [OWN_FOLDERS_FIELD]: 1 }, { [OWN_FOLDERS_FIELD]: "own" }]) {
      setOwnFolders(s);
      expect(singleFolder(), JSON.stringify(s)).toBe(true);
    }
    setOwnFolders({ [OWN_FOLDERS_FIELD]: true });
    expect(singleFolder()).toBe(false);
    setOwnFolders({});
    expect(singleFolder(), "turning it off again brings one folder back").toBe(true);
  });

  it("off (the default): every launch shares the project folder, whatever the last launch chose", () => {
    expect(defaultCopies(1, true)).toBe("shared");
    expect(defaultCopies(5, true)).toBe("shared");
    expect(sheetStart({ shape: "custom", copies: "separate", seats: [{ agent: "claude", model: "default" }, { agent: "codex", model: "default" }] }, true).copies).toBe("shared");
    expect(projectMenu().map((i) => i.id)).toEqual(["proj:settings", "proj:remove"]);
    expect(worktreesOffNote("workspace.create")).toBe(WORKTREES_OFF);
  });

  it("on: two or more seats in a Git project start with a folder each; one seat, or a folder outside Git, shares", () => {
    setOwnFolders({ [OWN_FOLDERS_FIELD]: true });
    expect(defaultCopies(2, true)).toBe("separate");
    expect(defaultCopies(8, true)).toBe("separate");
    expect(defaultCopies(1, true)).toBe("shared");
    expect(defaultCopies(4, false), "nothing to copy outside Git").toBe("shared");
  });

  it("on: the launch sheet brings back the last launch's choice, and never offers own folders outside Git", () => {
    setOwnFolders({ [OWN_FOLDERS_FIELD]: true });
    const two = [{ agent: "claude", model: "default" }, { agent: "codex", model: "default" }];
    expect(sheetStart({ shape: "custom", copies: "shared", seats: two }, true).copies).toBe("shared");
    expect(sheetStart({ shape: "custom", copies: "separate", seats: two }, true).copies).toBe("separate");
    expect(sheetStart({ shape: "custom", copies: "separate", seats: two }, false).copies).toBe("shared");
    expect(sheetStart(undefined, true).copies, "a first launch is one seat, so it shares").toBe("shared");
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
