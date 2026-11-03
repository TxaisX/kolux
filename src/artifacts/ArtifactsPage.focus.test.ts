// The Remove confirm's focus on the small DOM: backing out (Cancel or Escape) hands focus back to the "x" that opened it,
// and a removal hands it to the next row, else the previous, else the search box. Cancel leaves the row where it was.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FakeNode as Node, click, fire, find, installDom, mount, settle, until, type FakeDocument, type FakeNode } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ lib: [] as { id: string; title: string; added: number }[], removed: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "artifacts_list") return Promise.resolve([...h.lib].sort((a, b) => b.added - a.added).map((e) => ({ ...e, source: "hand", origin: e.id, kind: "page", project: null, session: null, size: 9, page: `${e.id}.html`, state: "ok", stored: true })));
    if (cmd === "artifact_remove") {
      h.removed.push(String(args.id));
      h.lib = h.lib.filter((e) => e.id !== args.id);
    }
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
const focused: unknown[] = [];
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(Node.prototype, { isConnected: true, focus() { focused.push(this); } });
  focused.length = 0;
  h.removed = [];
  h.lib = [{ id: "a", title: "First", added: 3 }, { id: "b", title: "Second", added: 2 }, { id: "c", title: "Third", added: 1 }];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function page() {
  const { default: ArtifactsPage } = await import("./ArtifactsPage");
  const m = await mount(createElement(ArtifactsPage, { onToast: () => {} }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  return c;
}
const cls = (n: FakeNode) => String(n.attrs.className ?? n.attrs.class ?? "");
const items = (c: FakeNode) => find(c, (n) => n.attrs.role === "listitem");
const titles = (c: FakeNode) => items(c).map((r) => find(r, (n) => cls(n) === "name")[0]?.textContent);
const x = (c: FakeNode, title: string) => find(c, (n) => n.attrs["aria-label"] === `Remove ${title}`)[0];
const selectButton = (c: FakeNode, title: string) => find(items(c).find((r) => r.textContent.includes(title))!, (n) => n.localName === "button" && cls(n).startsWith("art-row"))[0];
const word = (c: FakeNode, text: string) => find(c, (n) => n.localName === "button" && n.textContent.trim() === text)[0];
const ask = (c: FakeNode) => find(c, (n) => n.attrs.role === "alertdialog")[0];
const last = () => focused[focused.length - 1];

test("Cancel returns focus to the x that opened the confirm and leaves the row in place", async () => {
  const c = await page();
  const opener = x(c, "Second");
  await click(c, opener);
  await until(() => !!ask(c));
  await click(c, word(c, "Cancel"));
  await until(() => !ask(c));
  await until(() => last() === opener);
  expect(titles(c)).toEqual(["First", "Second", "Third"]);
  expect(h.removed).toEqual([]);
});

test("Escape returns focus to the x that opened the confirm", async () => {
  const c = await page();
  const opener = x(c, "First");
  await click(c, opener);
  await until(() => !!ask(c));
  await fire(c, "keydown", word(c, "Cancel"), { key: "Escape" });
  await until(() => !ask(c));
  await until(() => last() === opener);
  expect(titles(c)).toEqual(["First", "Second", "Third"]);
});

test("Remove moves focus to the next row's select button", async () => {
  const c = await page();
  await click(c, x(c, "First"));
  await until(() => !!ask(c));
  await click(c, word(c, "Remove"));
  await until(() => titles(c).length === 2);
  await until(() => last() === selectButton(c, "Second"));
});

test("removing the last row moves focus to the previous row", async () => {
  const c = await page();
  await click(c, x(c, "Third"));
  await until(() => !!ask(c));
  await click(c, word(c, "Remove"));
  await until(() => titles(c).length === 2);
  await until(() => last() === selectButton(c, "Second"));
});

test("removing the only row moves focus to the search box", async () => {
  h.lib = [{ id: "a", title: "First", added: 1 }];
  const c = await page();
  await click(c, x(c, "First"));
  await until(() => !!ask(c));
  await click(c, word(c, "Remove"));
  await until(() => titles(c).length === 0);
  await until(() => last() === find(c, (n) => n.localName === "input")[0]);
});
