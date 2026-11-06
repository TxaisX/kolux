// SET-004 box 2 (colour fade held off on a light/dark switch; box 1's pieces are checked here too, its 60 fps recording is LIVE) and
// SET-006 boxes 1-2: the real SettingsPage on the small DOM, opened the way App.tsx opens it for Mod+Comma.
// MIRROR src/App.tsx:668-671 and :563-566 (`app.settings`: setSettingsAt({target:null}); setSettingsOpen(true)): the keymap match is the product's
// matchEvent over the default keymap; the "which page" decision is the product's SettingsPage (target null -> lastPage()/first), only the open flag is copied.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { defaultsOnly, matchEvent } from "../../keys/keymap";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../../tasks/fakeDom";

const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const readFileSync = (rel: string) => nodeFs.readFileSync(new URL(rel, import.meta.url), "utf8");

const h = vi.hoisted(() => ({ projects: [] as { id: string; name: string }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "project_list") return Promise.resolve(JSON.parse(JSON.stringify(h.projects)));
    if (cmd === "get_settings") return Promise.resolve({});
    return Promise.reject("not stubbed");
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

let doc: FakeDocument;
let store: Map<string, string>;
let vars: Record<string, string> = {};
let classes: string[] = [];
let frames: (() => void)[] = [];
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  store = dom.store;
  Object.assign(globalThis, { localStorage: dom.win.localStorage });
  vars = {};
  classes = [];
  frames = [];
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, dispatchEvent: () => true });
  Object.assign(globalThis, { requestAnimationFrame: (f: () => void) => frames.push(f), cancelAnimationFrame() {} });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  Object.assign(doc.documentElement, {
    style: { setProperty: (k: string, v: string) => void (vars[k] = v), removeProperty() {} },
    dataset: {},
    classList: { add: (c: string) => void classes.push("+" + c), remove: (c: string) => void classes.push("-" + c) },
  });
  h.projects = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});
const nextFrame = () => frames.splice(0).forEach((f) => f());

test("SET-004 box 2: Light -> Dark and back holds colour transitions off for two frames, and the rule covers every descendant", async () => {
  const theme = await import("../../theme");
  theme.applyAppearance(theme.readAppearance({ appearanceMode: "light" })); // the start: nothing to fade from
  expect(classes).toEqual([]);
  theme.applyAppearance(theme.readAppearance({ appearanceMode: "dark" }));
  expect(classes).toEqual(["+no-anim"]); // set in the same call that writes the dark tokens
  expect(vars["color-scheme"]).toBe("dark");
  nextFrame();
  expect(classes).toEqual(["+no-anim"]); // one frame is not enough
  nextFrame();
  expect(classes).toEqual(["+no-anim", "-no-anim"]); // released after the second
  theme.applyAppearance(theme.readAppearance({ appearanceMode: "dark", themeSaturation: 50 })); // same mode: no hold needed
  expect(classes).toHaveLength(2);
  theme.applyAppearance(theme.readAppearance({ appearanceMode: "light" })); // and back
  expect(classes.slice(2)).toEqual(["+no-anim"]);
  nextFrame();
  nextFrame();
  expect(classes.slice(2)).toEqual(["+no-anim", "-no-anim"]);
  const css = readFileSync("../../styles.css");
  expect(css).toMatch(/\.no-anim,\s*\.no-anim \* \{ transition: none !important; \}/);
});

test("SET-004 box 1 (pieces only): the window is created hidden and the page's first script puts the saved dark Cobalt tokens and font on the root", async () => {
  const theme = await import("../../theme");
  theme.applyAppearance(theme.readAppearance({ appearanceMode: "dark", appTheme: "cobalt", appFont: "Fira Sans" })); // what the last run cached
  const cached = store.get(theme.CACHE_KEY)!;
  expect(JSON.parse(cached).vars["--ui-font"]).toMatch(/^"?Fira Sans"?,/);
  const html = readFileSync("../../../index.html");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  const root: Record<string, string> = {};
  new Function("localStorage", "document", script)({ getItem: () => cached }, { documentElement: { style: { setProperty: (k: string, v: string) => void (root[k] = v) } } });
  expect(root["color-scheme"]).toBe("dark");
  expect(root["--ui-font"]).toBe(JSON.parse(cached).vars["--ui-font"]);
  expect(root["--surface"]).toBe(vars["--surface"]);
  expect(root["--surface"]).not.toBe("#171717");
  const conf = JSON.parse(readFileSync("../../../src-tauri/tauri.conf.json"));
  expect(conf.app.windows[0].visible).toBe(false);
});

// Grouped like Claude's settings rail: Personal, AI, Workspace, Usage.
const NAV = ["General", "Appearance", "Notifications", "Shortcuts", "Accounts & keys", "Agents", "Claude", "Terminal & sessions", "Git & worktrees", "Safety", "Usage"];
const links = (c: FakeNode) => find(c, (n) => n.localName === "button" && /settings-link/.test(n.attrs.class ?? ""));
const current = (c: FakeNode) => links(c).filter((n) => n.attrs["aria-current"] === "page").map((n) => n.textContent.trim());
const heading = (c: FakeNode) => find(c, (n) => n.localName === "h1")[0]?.textContent.trim();

/** Mod+Comma as the window sees it, then App.tsx's open (target null). */
async function openWithShortcut(platform: "win32" | "darwin" = "win32") {
  const key = { key: ",", code: "Comma", ctrlKey: platform === "win32", metaKey: platform === "darwin", altKey: false, shiftKey: false };
  expect(matchEvent(defaultsOnly(platform), key, ["global"])).toEqual({ id: "app.settings" }); // the real default keymap
  const { default: SettingsPage } = await import("../SettingsPage");
  const m = await mount(createElement(SettingsPage, { onClose: () => {}, target: null, n: 0 }), doc);
  unmount = m.unmount;
  await until(() => links(m.container).length >= 11, "the side list");
  await settle();
  return m;
}

test("SET-006 box 1: Mod+Comma opens Settings on the last page used, or the first", async () => {
  expect(store.get("kolux.settingsPage")).toBeUndefined();
  const first = await openWithShortcut();
  expect(current(first.container)).toEqual(["General"]); // nothing used yet: the first page
  expect(heading(first.container)).toBe("General");
  await click(first.container, links(first.container).find((n) => n.textContent.trim() === "Appearance")!);
  expect(current(first.container)).toEqual(["Appearance"]);
  await unmount();
  const again = await openWithShortcut("darwin"); // closed and opened again with Cmd+Comma
  expect(current(again.container)).toEqual(["Appearance"]);
  expect(heading(again.container)).toBe("Appearance");
  await unmount();
  store.set("kolux.settingsPage", "no-such-page"); // a page that no longer exists: the first
  const stale = await openWithShortcut();
  expect(current(stale.container)).toEqual(["General"]);
});

test("SET-006 box 1 (repository page): the repository page used last comes back once the project list is read", async () => {
  h.projects = [{ id: "p1", name: "alpha" }, { id: "p2", name: "beta" }];
  store.set("kolux.settingsPage", "repo:p2");
  const m = await openWithShortcut();
  await until(() => current(m.container).includes("beta"), "the remembered repository page");
  expect(heading(m.container)).toBe("beta");
  expect(store.get("kolux.settingsPage")).toBe("repo:p2"); // not overwritten by the placeholder General
});

test("SET-006 box 2: the side list has exactly the eleven named pages, then one per repository", async () => {
  h.projects = [{ id: "p1", name: "alpha" }, { id: "p2", name: "beta" }, { id: "p3", name: "gamma" }];
  const m = await openWithShortcut();
  await until(() => links(m.container).length === 14, "the repositories");
  const all = links(m.container);
  expect(all.slice(0, 11).map((n) => n.textContent.trim())).toEqual(NAV);
  expect(all.slice(0, 11).some((n) => /\brepo\b/.test(n.attrs.class ?? ""))).toBe(false);
  expect(all.slice(11).map((n) => n.textContent.trim())).toEqual(["alpha", "beta", "gamma"]);
  expect(all.slice(11).every((n) => /\brepo\b/.test(n.attrs.class ?? ""))).toBe(true);
  expect(all).toHaveLength(NAV.length + h.projects.length);
  await unmount();
  h.projects = [];
  const none = await openWithShortcut();
  await settle();
  expect(links(none.container).map((n) => n.textContent.trim())).toEqual(NAV); // no repository, no extra page
});
