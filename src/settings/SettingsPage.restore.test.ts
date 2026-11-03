// SET-006 box 1: Settings opens on the page used last, including a repository page that waits for project_list.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ projects: [] as { id: string; name: string }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "project_list") return Promise.resolve(JSON.parse(JSON.stringify(h.projects)));
    if (cmd === "get_settings") return Promise.resolve({});
    return Promise.reject("not stubbed");
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

const KEY = "kolux.settingsPage";
let doc: FakeDocument;
let store: Map<string, string>;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  store = dom.store;
  Object.assign(globalThis, { localStorage: dom.win.localStorage });
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, dispatchEvent: () => true });
  Object.assign(globalThis, { requestAnimationFrame: () => 0, cancelAnimationFrame() {} });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.projects = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const links = (c: FakeNode) => find(c, (n) => n.localName === "button" && /settings-link/.test(n.attrs.class ?? ""));
const current = (c: FakeNode) => links(c).filter((n) => n.attrs["aria-current"] === "page").map((n) => n.textContent.trim());
const heading = (c: FakeNode) => find(c, (n) => n.localName === "h1")[0]?.textContent.trim();

async function open() {
  const { default: SettingsPage } = await import("./SettingsPage");
  const m = await mount(createElement(SettingsPage, { onClose: () => {}, target: null, n: 0 }), doc);
  unmount = m.unmount;
  await until(() => links(m.container).length >= 10, "the side list");
  await settle();
  return m;
}

test("a repository page used last comes back once the project list is read", async () => {
  h.projects = [{ id: "p1", name: "alpha" }, { id: "p2", name: "beta" }];
  store.set(KEY, "repo:p2");
  const m = await open();
  await until(() => current(m.container).includes("beta"), "the remembered repository page");
  expect(heading(m.container)).toBe("beta");
  expect(store.get(KEY)).toBe("repo:p2");
});

test("a fixed page used last comes back", async () => {
  store.set(KEY, "shortcuts");
  const m = await open();
  expect(current(m.container)).toEqual(["Shortcuts"]);
  expect(store.get(KEY)).toBe("shortcuts");
});

test("a repository that no longer exists shows General and the stored value is kept", async () => {
  h.projects = [{ id: "p1", name: "alpha" }];
  store.set(KEY, "repo:gone");
  const m = await open();
  await until(() => links(m.container).length === 12, "the repositories");
  await settle();
  expect(current(m.container)).toEqual(["General"]);
  expect(store.get(KEY)).toBe("repo:gone");
});

test("a page the user picks is remembered", async () => {
  h.projects = [{ id: "p1", name: "alpha" }];
  const m = await open();
  await until(() => links(m.container).length === 12, "the repositories");
  await click(m.container, links(m.container).find((n) => n.textContent.trim() === "alpha")!);
  expect(store.get(KEY)).toBe("repo:p1");
  await click(m.container, links(m.container).find((n) => n.textContent.trim() === "Appearance")!);
  expect(store.get(KEY)).toBe("appearance");
});
