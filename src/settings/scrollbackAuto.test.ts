// DT-C228: with no scrollback saved, the Terminal page shows the automatic rows this computer's memory
// profile sets (what every pane really keeps), not the 1000-row start value.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../tasks/fakeDom";

const stub = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) =>
    cmd === "get_settings"
      ? Promise.resolve(stub.settings)
      : cmd === "shell_list"
        ? Promise.resolve([])
        : cmd === "terminal_memory_profile"
          ? Promise.resolve({ profile: "large", totalMb: 32768, scrollback: 10000 })
          : Promise.reject("not stubbed"),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
vi.mock("@xterm/xterm", () => ({ Terminal: class { options = {}; open() {} write() {} dispose() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(globalThis, { localStorage: dom.win.localStorage });
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, dispatchEvent: () => true });
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const scrollbackInput = (c: FakeNode) => find(c, (n) => n.localName === "label" && n.textContent.startsWith("Scrollback rows"))[0]?.childNodes.find((n) => n.localName === "input");

test("unset scrollback shows the automatic rows from the memory profile", async () => {
  stub.settings = {};
  const { default: TerminalPage } = await import("./TerminalPage");
  const m = await mount(createElement(TerminalPage), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await until(() => c.textContent.includes("Automatic (10000 rows)"), "the automatic scrollback note");
  expect(scrollbackInput(c)?.value).toBe("10000");
}, 60000); // the first import of the page transforms its whole tree

test("a saved scrollback is shown as saved, with no automatic note", async () => {
  stub.settings = { terminalScrollback: 3000 };
  const { default: TerminalPage } = await import("./TerminalPage");
  const m = await mount(createElement(TerminalPage), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await until(() => c.textContent.includes("History and scrolling"), "the scrolling section");
  await until(() => !!scrollbackInput(c), "the scrollback field");
  await settle(); // the memory profile has answered by now
  expect(c.textContent).not.toContain("Automatic (");
  expect(scrollbackInput(c)?.value).toBe("3000");
}, 60000);
