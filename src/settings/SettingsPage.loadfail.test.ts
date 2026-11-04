// T-752 (DT-C188): Settings says when its lists cannot be read and offers Try again, instead of a bare
// error with no controls (a failed settings read) or a Repositories group that silently vanishes.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byText, click, type FakeDocument, type FakeNode, find, installDom, mount, settle, until, withText } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ projectFails: 0, settingsFails: 0 }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "project_list") return h.projectFails-- > 0 ? Promise.reject("the store is locked") : Promise.resolve([{ id: "p1", name: "alpha" }]);
    if (cmd === "get_settings") return h.settingsFails-- > 0 ? Promise.reject("settings.json is unreadable") : Promise.resolve({});
    return Promise.reject("not stubbed");
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(globalThis, { localStorage: dom.win.localStorage });
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, dispatchEvent: () => true });
  Object.assign(globalThis, { requestAnimationFrame: () => 0, cancelAnimationFrame() {} });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.projectFails = 0;
  h.settingsFails = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const nav = (c: FakeNode) => find(c, (n) => n.localName === "nav")[0];
const main = (c: FakeNode) => find(c, (n) => n.localName === "main")[0];
const confirmations = (c: FakeNode) => find(main(c), (n) => n.attrs["data-section"] === "confirmations");

async function open() {
  const { default: SettingsPage } = await import("./SettingsPage");
  const m = await mount(createElement(SettingsPage, { onClose: () => {}, target: null, n: 0 }), doc);
  unmount = m.unmount;
  await settle();
  return m;
}

test("a project list that cannot be read keeps Repositories, says why, and Try again reads it", async () => {
  h.projectFails = 1;
  const m = await open();
  await until(() => withText(nav(m.container), "p", "The repositories could not be listed: the store is locked").length === 1, "the error");
  expect(byText(nav(m.container), "div", "Repositories")).toHaveLength(1);
  await click(m.container, byText(nav(m.container), "button", "Try again")[0]);
  await until(() => byText(nav(m.container), "button", "alpha").length === 1, "the repository");
  expect(withText(nav(m.container), "p", "could not be listed")).toHaveLength(0);
});

test("settings that cannot be read say so with Try again, which brings the page's controls", async () => {
  h.settingsFails = 1;
  const m = await open();
  await until(() => withText(main(m.container), "p", "The settings could not be read: settings.json is unreadable").length === 1, "the error");
  expect(confirmations(m.container)).toHaveLength(0);
  await click(m.container, byText(main(m.container), "button", "Try again")[0]);
  await until(() => confirmations(m.container).length === 1, "the General page's controls");
  expect(withText(main(m.container), "p", "could not be read")).toHaveLength(0);
});

test("a failed save keeps a plain line that says the change was not saved, with no Try again", async () => {
  const { renderToString } = await import("react-dom/server");
  const { SettingsError } = await import("./SettingsError");
  const html = renderToString(createElement(SettingsError, { error: "disk full", loaded: true, onRetry: () => {} }));
  expect(html).toContain("The change could not be saved: disk full");
  expect(html).not.toContain("Try again");
});
