// SET-006 box 3: a link from elsewhere opens Settings on a chosen page and section, waits until it is drawn, then scrolls it into view.
// Finding: the only in-app caller that targets Shortcuts opens "shortcuts-file" (App.tsx keymap notice); none opens "terminal-first".
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../../test/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => (cmd === "project_list" ? Promise.resolve([]) : cmd === "get_settings" ? Promise.resolve({}) : Promise.reject("not stubbed")),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

let doc: FakeDocument;
let frames: (() => void)[] = [];
let unmount: () => Promise<void> = async () => {};
let root: FakeNode;
const scrolled: string[] = [];
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  frames = [];
  scrolled.length = 0;
  Object.assign(globalThis, { localStorage: dom.win.localStorage, CSS: { escape: (s: string) => s }, requestAnimationFrame: (f: () => void) => frames.push(f), cancelAnimationFrame() {} });
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, dispatchEvent: () => true });
  Object.assign(doc, {
    querySelectorAll: () => [],
    visibilityState: "visible",
    hidden: false,
    // `.settings-main [data-section="x"]`, answered from the drawn tree; scrollIntoView is recorded.
    querySelector: (sel: string) => {
      const id = /data-section="([^"]+)"/.exec(sel)?.[1];
      const el = id ? find(root, (n) => n.attrs["data-section"] === id)[0] : undefined;
      if (el) Object.assign(el, { closest: () => null, scrollIntoView: () => void scrolled.push(id!), classList: { add() {}, remove() {} } });
      return el ?? null;
    },
  });
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const heading = (c: FakeNode) => find(c, (n) => n.localName === "h1")[0]?.textContent.trim();

async function openAt(target: { page: "shortcuts"; section: string }) {
  const { default: SettingsPage } = await import("../SettingsPage");
  const m = await mount(createElement(SettingsPage, { onClose: () => {}, target, n: 1 }), doc);
  unmount = m.unmount;
  root = m.container as FakeNode;
  return m;
}

for (const section of ["terminal-first", "shortcuts-file"]) {
  test(`SET-006 box 3: a link to Shortcuts / ${section} opens the Shortcuts page, waits until the section is drawn, then scrolls it into view`, async () => {
    const m = await openAt({ page: "shortcuts", section });
    await until(() => heading(m.container) === "Shortcuts", "the Shortcuts page");
    await until(() => find(root, (n) => n.attrs["data-section"] === section).length > 0, `the ${section} section`);
    for (let i = 0; i < 5 && !scrolled.length; i++) {
      frames.splice(0).forEach((f) => f());
      await settle();
    }
    expect(scrolled).toEqual([section]);
  });
}
