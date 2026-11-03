// VIEW-012 acceptance: the real ArtifactsPage on the small DOM against an in-memory library.
// MIRROR: the stand-in artifacts_list returns newest first as Library::list does (cards_05.rs view012_box1_* proves that order in Rust).
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle, typeInto, until } from "../../tasks/fakeDom";

const h = vi.hoisted(() => ({ lib: [] as { id: string; title: string; added: number }[], picks: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "artifacts_list") return Promise.resolve([...h.lib].sort((a, b) => b.added - a.added).map((e) => ({ ...e, source: "hand", origin: e.id, project: null, session: null, size: 2048, page: `${e.id}.html`, state: "ok", stored: true })));
    if (cmd === "artifact_add") {
      const path = String(args.path);
      const e = { id: path, title: path.replace(/\.html$/, ""), added: 1000 + h.lib.length };
      h.lib.push(e);
      return Promise.resolve({ ...e, page: path, state: "ok", stored: true });
    }
    if (cmd === "artifact_remove") {
      h.lib = h.lib.filter((e) => e.id !== args.id);
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(h.picks.shift() ?? null) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  h.lib = [];
  h.picks = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function page() {
  const { default: ArtifactsPage } = await import("../ArtifactsPage");
  const m = await mount(createElement(ArtifactsPage, { onToast: () => {} }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  return c;
}
const rows = (c: FakeNode) => find(c, (n) => n.attrs.role === "listitem" && String(n.attrs.className ?? n.attrs.class ?? "") === "art-item");
const titles = (c: FakeNode) => rows(c).map((r) => find(r, (n) => String(n.attrs.className ?? n.attrs.class ?? "") === "name")[0]?.textContent);
const addButton = (c: FakeNode) => find(c, (n) => n.localName === "button" && n.textContent.trim() === "Add artifact")[0];
const frames = (c: FakeNode) => find(c, (n) => n.localName === "iframe");

test("box 1: add two files and the newest is on top", async () => {
  const c = await page();
  h.picks = ["alpha.html", "beta.html"];
  await click(c, addButton(c));
  await until(() => titles(c).length === 1);
  await click(c, addButton(c));
  await until(() => titles(c).length === 2);
  expect(titles(c)).toEqual(["beta", "alpha"]);
});

test("box 2: two typed words where only one matches a title hides that item", async () => {
  h.lib = [{ id: "a", title: "Quarterly Sales Report", added: 2 }, { id: "b", title: "Sales Chart", added: 1 }];
  const c = await page();
  expect(titles(c)).toEqual(["Quarterly Sales Report", "Sales Chart"]);
  const input = find(c, (n) => n.localName === "input")[0];
  await typeInto(c, input, "sales chart");
  expect(titles(c)).toEqual(["Sales Chart"]);
  await typeInto(c, input, "sales nothing");
  expect(titles(c)).toEqual([]);
  expect(c.textContent).toContain("No titles hold every word of “sales nothing”.");
});

test("box 3: removing the selected item leaves the list and the preview closes", async () => {
  h.lib = [{ id: "a", title: "First", added: 2 }, { id: "b", title: "Second", added: 1 }];
  const c = await page();
  await click(c, find(rows(c)[0], (n) => n.localName === "button")[0]);
  await until(() => frames(c).length === 1);
  expect(c.textContent).not.toContain("Pick an artifact to view it here.");
  const remove = find(rows(c)[0], (n) => n.attrs["aria-label"] === "Remove First")[0];
  await click(c, remove);
  // The removal waits for a yes that names the artifact; nothing is gone before it.
  expect(titles(c)).toEqual(["First", "Second"]);
  expect(find(c, (n) => n.attrs.role === "alertdialog")[0].attrs["aria-label"]).toBe("Remove First?");
  await click(c, find(c, (n) => n.localName === "button" && n.textContent.trim() === "Remove")[0]);
  await until(() => titles(c).length === 1);
  expect(titles(c)).toEqual(["Second"]);
  expect(frames(c)).toEqual([]);
  expect(c.textContent).toContain("Pick an artifact to view it here.");
});
