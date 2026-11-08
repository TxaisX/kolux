import { describe, expect, it } from "vitest";
import { paletteCreateName, SINGLE_FOLDER, worktreesOffNote, WORKTREES_OFF } from "./singleFolder";

describe("T-798 worktrees off", () => {
  it("the palette has nothing to create from typed text while worktrees are off", () => {
    expect(SINGLE_FOLDER).toBe(true);
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
