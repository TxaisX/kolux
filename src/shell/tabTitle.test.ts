import { describe, expect, it } from "vitest";
import { generatedOn, generatedTitle, tabText, tabTip } from "./tabTitle";

describe("term-056 tab titles", () => {
  it("generated titles are off by default and on only when the field is true", () => {
    expect(generatedOn({})).toBe(false);
    expect(generatedOn({ generatedTabTitles: "yes" })).toBe(false);
    expect(generatedOn({ generatedTabTitles: true })).toBe(true);
  });

  it("the generated name is the agent and branch, else agent and folder, clipped", () => {
    expect(generatedTitle({ word: "Claude", branch: "feat/login", cwd: "C:/w/app" })).toBe("Claude · feat/login");
    expect(generatedTitle({ word: "Codex", branch: null, cwd: "C:\\w\\app" })).toBe("Codex · app");
    expect(generatedTitle({ word: "Codex", branch: null, cwd: null })).toBe("Codex");
    expect(generatedTitle({ word: "Claude", branch: "feature/a-very-long-branch-name-here", cwd: null })).toBe("Claude · feature/a-very…");
  });

  it("off keeps the program's title; on shows the generated one; a typed name always wins", () => {
    expect(tabText({ full: "claude — running tests", own: null, generated: "Claude · main", on: false })).toBe("claude — running tests");
    expect(tabText({ full: "claude — running tests", own: null, generated: "Claude · main", on: true })).toBe("Claude · main");
    expect(tabText({ full: "Mine", own: "Mine", generated: "Claude · main", on: true })).toBe("Mine");
  });

  it("the tooltip is the full title, naming the shown text when it differs", () => {
    expect(tabTip("claude — running tests", "claude — running tests")).toBe("claude — running tests");
    expect(tabTip("claude — running tests", "Claude · main")).toBe("claude — running tests · shown as Claude · main");
  });
});
