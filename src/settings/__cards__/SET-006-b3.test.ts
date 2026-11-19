// SET-006 box 3, caller half: the Terminal settings page has a link that asks the window to open Shortcuts at the "terminal-first" policy.
// The product's openSettings runs for real; the window event it dispatches is the seam. SET-006-link.test.ts proves what Settings does with that target.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../../test/fakeDom";
import { OPEN_SETTINGS, type SettingsTarget } from "../pages";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => (cmd === "get_settings" ? Promise.resolve({}) : cmd === "shell_list" ? Promise.resolve([]) : Promise.reject("not stubbed")),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
vi.mock("@xterm/xterm", () => ({ Terminal: class { options = {}; open() {} write() {} dispose() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
const opened: SettingsTarget[] = [];
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  opened.length = 0;
  Object.assign(globalThis, { localStorage: dom.win.localStorage });
  Object.assign(dom.win, {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    dispatchEvent: (e: CustomEvent<SettingsTarget>) => {
      if (e.type === OPEN_SETTINGS) opened.push(e.detail);
      return true;
    },
  });
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

test("SET-006 box 3: the link on Terminal settings opens Shortcuts at the terminal-first policy", async () => {
  const { default: TerminalPage } = await import("../TerminalPage");
  const m = await mount(createElement(TerminalPage), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  const link = () => find(c, (n) => n.localName === "button" && /Shortcuts settings/.test(n.textContent))[0];
  await until(() => !!link(), "the link to the shortcut policy");
  expect(link().attrs.class).toBe("btn link");
  await click(c, link());
  await settle();
  expect(opened).toEqual([{ page: "shortcuts", section: "terminal-first" }]);
}, 60000); // the first import of the page transforms its whole tree
