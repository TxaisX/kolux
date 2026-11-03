// UX audit pass 2 on the real BrowserPane: the notice closes, the cookie menu is real buttons, the tooltips read the keymap.
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, fire } from "../../tasks/fakeDom";
import { button, installPaneDom, mountPane, rec } from "./paneHarness";

const script = vi.hoisted(() => ({ goFails: false }));
vi.mock("@tauri-apps/api/core", async () => {
  const h = await import("./paneHarness");
  return {
    invoke: (cmd: string, args: Record<string, unknown> = {}) => {
      h.rec.calls.push({ cmd, args });
      if (cmd === "browser_go" && script.goFails && args.what === "reload") return Promise.reject("the page would not reload");
      return Promise.resolve(cmd === "browser_suggest" ? [] : null);
    },
  };
});
vi.mock("@tauri-apps/api/event", async () => (await import("./paneHarness")).eventMock);
vi.mock("@tauri-apps/api/webview", async () => (await import("./paneHarness")).webviewMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("./paneHarness")).dialogMock);

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installPaneDom();
  script.goFails = false;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});
const alerts = (c: FakeNode) => find(c, (n) => n.attrs.role === "alert" && n.attrs["data-kind"] === undefined);
async function pane() {
  const m = await mountPane(doc);
  unmount = m.unmount;
  return m.container as FakeNode;
}

test("a failed reload says so, and the notice has a Dismiss button that closes it", async () => {
  script.goFails = true;
  const c = await pane();
  await click(c, button(c, "reloadAny"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(alerts(c)[0]?.textContent).toContain("would not reload");
  await click(c, button(c, "dismiss-notice"));
  expect(alerts(c)).toHaveLength(0);
});

test("Import cookies opens a menu of real buttons that Escape closes", async () => {
  const c = await pane();
  const opener = find(c, (n) => n.localName === "button" && n.attrs["aria-label"] === "Import cookies")[0];
  expect(opener.querySelector?.("svg") ?? find(opener, (n) => n.localName === "svg")[0]).toBeTruthy();
  await click(c, opener);
  const items = find(c, (n) => n.attrs.role === "menuitem");
  expect(items.length).toBeGreaterThan(1);
  expect(items.every((n) => n.localName === "button")).toBe(true);
  const menu = find(c, (n) => n.attrs.role === "menu")[0];
  await fire(c, "keydown", menu, { key: "Escape" });
  expect(find(c, (n) => n.attrs.role === "menuitem")).toHaveLength(0);
});

test("the toolbar tooltips read their chord from the keymap", async () => {
  const c = await pane();
  const titles = find(c, (n) => n.localName === "button").map((n) => n.attrs.title ?? "");
  expect(titles.some((t) => /^Reload \(.+\)$/.test(t))).toBe(true);
  expect(titles.some((t) => /^Close tab/.test(t))).toBe(true);
  expect(rec.calls.length).toBeGreaterThan(0);
});
