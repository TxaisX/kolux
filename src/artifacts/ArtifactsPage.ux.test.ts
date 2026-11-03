// The library page's failure states on the small DOM: a file picker that fails says so, and a page that never
// reports it loaded is called out instead of showing "Loading…" for good.
import { createElement } from "react";
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, click, find, installDom, mount, settle, until } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({ pickFails: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "artifacts_list") return Promise.resolve([{ id: "a", title: "First", source: "hand", origin: "a", kind: "page", project: null, session: null, added: 1, size: 9, page: "a.html", state: "ok", stored: true }]);
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => (h.pickFails ? Promise.reject("no picker") : Promise.resolve(null)) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
const toasts: string[] = [];
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  h.pickFails = false;
  toasts.length = 0;
});
afterEach(async () => {
  vi.useRealTimers();
  await unmount();
  unmount = async () => {};
});

async function page() {
  const { default: ArtifactsPage } = await import("./ArtifactsPage");
  const m = await mount(createElement(ArtifactsPage, { onToast: (t: string) => toasts.push(t) }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  return c;
}

test("a file picker that fails is reported; closing it without a pick is not", async () => {
  const c = await page();
  const add = find(c, (n) => n.localName === "button" && n.textContent.trim() === "Add artifact")[0];
  await click(c, add);
  await settle();
  expect(toasts).toEqual([]);
  h.pickFails = true;
  await click(c, add);
  await until(() => toasts.length === 1);
  expect(toasts[0]).toBe("Could not open the file picker: no picker");
});

test("a page that never loads says so after the wait, and its frame stays hidden until it loads", async () => {
  const { SLOW_MS } = await import("./ArtifactsPage");
  const c = await page();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await click(c, find(c, (n) => n.localName === "button" && n.attrs["aria-current"] === undefined && String(n.attrs.className ?? n.attrs.class ?? "") === "art-row")[0]);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(c.textContent).toContain("Loading…");
  const frame = find(c, (n) => n.localName === "iframe")[0];
  expect(String(frame.attrs.style ?? JSON.stringify(frame.style ?? ""))).toContain("hidden");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SLOW_MS + 1);
  });
  expect(c.textContent).not.toContain("Loading…");
  expect(c.textContent).toContain("taking a long time to load");
});
