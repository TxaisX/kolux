// Audit N-45: a search draws every page that holds a match, and it used to draw each one in full: a
// Claude setup disk scan, the GitHub budget and the branch-prefix check, the shell list and a real
// sample terminal, one workspace list per project. Typing a word cost all of that. With `SearchRun`
// true the cards still draw their headings and controls, and the reads wait until the page is opened.
import { createElement, type ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, installDom, mount, settle, withText } from "../test/fakeDom";

const h = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    if (cmd === "get_settings") return Promise.resolve({ branchPrefix: "user", branchPrefixCustom: "txais" });
    if (cmd === "project_list") return Promise.resolve([{ id: "p1", name: "kolux", displayName: "Kolux", path: "G:/kolux" }]);
    if (cmd === "agent_list" || cmd === "workspace_list" || cmd === "scm_gh_budget" || cmd === "shell_list") return Promise.resolve([]);
    if (cmd === "branch_prefix_check") return Promise.resolve({ prefix: "txais/", refused: false });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  h.calls.length = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

/** A page as Settings draws it inside a search (or on its own page, with no search running). */
async function show(el: ReactElement, searching: boolean): Promise<FakeNode> {
  const { SearchRun } = await import("./search");
  const m = await mount(searching ? createElement(SearchRun.Provider, { value: true }, el) : el, doc);
  unmount = m.unmount;
  await settle();
  return m.container as FakeNode;
}

test("Git: a search reads neither the GitHub budget nor the branch prefix, and says both show when opened", async () => {
  const { default: GitPage } = await import("./GitPage");
  const c = await show(createElement(GitPage), true);
  expect(h.calls).not.toContain("scm_gh_budget");
  expect(h.calls).not.toContain("branch_prefix_check");
  expect(withText(c, "p", "remaining GitHub API requests show when you open this page").length).toBe(1);
  // The page itself still draws: the prefix field a search found is there to be changed.
  expect(find(c, (n) => n.attrs["aria-label"] === "branch prefix").length).toBe(1);
});

test("Git: opened on its own page, the same two reads run", async () => {
  const { default: GitPage } = await import("./GitPage");
  await show(createElement(GitPage), false);
  expect(h.calls).toContain("scm_gh_budget");
  expect(h.calls).toContain("branch_prefix_check");
});

test("Claude: a search runs no setup scan and offers no workspace picker", async () => {
  const { default: ClaudeSetupPage } = await import("./ClaudeSetupPage");
  const c = await show(createElement(ClaudeSetupPage), true);
  expect(h.calls).not.toContain("claude_setup");
  expect(find(c, (n) => n.attrs["aria-label"] === "workspace").length).toBe(0);
  expect(withText(c, "p", "show when you open this page").length).toBe(1);
});

test("Claude: opened on its own page, the setup scan runs", async () => {
  const { default: ClaudeSetupPage } = await import("./ClaudeSetupPage");
  await show(createElement(ClaudeSetupPage), false);
  expect(h.calls).toContain("claude_setup");
});

test("Automatic pull requests: a search reads no project or workspace list", async () => {
  const { default: AutoPrSettings } = await import("./autoPr");
  await show(createElement(AutoPrSettings), true);
  expect(h.calls).not.toContain("workspace_list");
  h.calls.length = 0;
  await show(createElement(AutoPrSettings), false);
  expect(h.calls).toContain("workspace_list");
});
