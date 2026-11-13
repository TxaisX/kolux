// N-20: the pull request comment panel, rendered. Only a render can say what the panel does when it is
// not the visible tab: it draws its heading and its options and asks GitHub nothing. The per-card
// pending/error rules it draws from (act() -> rowDone -> rowError) live in panelUx.ts and are tested
// there; this repo has no DOM environment, so a card's error cannot be driven through a click here.
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const asked: string[] = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    asked.push(cmd);
    return Promise.resolve(null);
  },
}));

const { default: CommentsPanel } = await import("./CommentsPanel");

const html = (visible: boolean) => renderToString(createElement(CommentsPanel, { dir: "C:/r", url: "https://github.com/o/r/pull/1", visible }));

describe("GIT-029: the comments panel draws before it has read anything", () => {
  it("shows its heading and its four options, and no card", () => {
    const out = html(false);
    expect(out).toContain('class="cm-panel"');
    for (const label of ["By time", "Hide bots", "Refresh", "Add comment"]) expect(out).toContain(`>${label}</button>`);
    expect(out).not.toContain('data-row-error');
    expect(out).not.toContain('class="cm-thread"');
  });
  it("reads nothing while the tab is not visible", () => {
    // The read is the effect's, and the effect only runs for a visible tab; a render must not ask by itself.
    html(false);
    html(true);
    expect(asked).toEqual([]);
  });
});