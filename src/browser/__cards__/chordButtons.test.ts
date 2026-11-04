// T-767: the browser's find and reload chords press the toolbar's own buttons, so a chord pressed in the app or
// forwarded by a page runs exactly what a click on the chrome runs, and the buttons the chord searches for exist
// once in the pane.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, mount } from "../../tasks/fakeDom";
import { button, installPaneDom, mountPane, rec, sent } from "./paneHarness";

vi.mock("@tauri-apps/api/core", async () => (await import("./paneHarness")).coreMock);
vi.mock("@tauri-apps/api/event", async () => (await import("./paneHarness")).eventMock);
vi.mock("@tauri-apps/api/webview", async () => (await import("./paneHarness")).webviewMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("./paneHarness")).dialogMock);
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isFocused: () => Promise.resolve(true) }) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installPaneDom();
  // The find bar focuses and selects its field a tick after it opens; the stand-in input has no select().
  const proto = (doc.createElement("input") as FakeNode).constructor.prototype as Record<string, unknown>;
  proto.select ??= () => {};
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function pane() {
  const m = await mountPane(doc);
  unmount = m.unmount;
  return m.container as FakeNode;
}

/** The element the chord action searches (`.pane.browser[data-key="7"]`). */
const paneRoot = (c: FakeNode) => find(c, (n) => n.localName === "section" && n.attrs["data-key"] === "7")[0];

/** The window hook's chord action (useBrowserChords), as the app and a forwarded page press it. */
async function chordAction() {
  const { useBrowserChords } = await import("../useBrowserChords");
  let action: ((key: number, what: string) => void) | null = null;
  function Probe() {
    action = useBrowserChords({ setFocused: () => {} }).browserAction;
    return null;
  }
  const m = await mount(createElement(Probe), doc);
  return { action: action as unknown as (key: number, what: string) => void, unmount: m.unmount };
}

test("t767 reload: the chord's button and the chrome's button run the same action", async () => {
  const c = await pane();
  rec.calls = [];
  await click(c, button(c, "reload"));
  const chrome = sent("browser_go").map((x) => x.args);
  expect(chrome).toEqual([{ id: 7, what: "reload" }]);
  rec.calls = [];
  await click(c, button(c, "reloadAny"));
  expect(sent("browser_go").map((x) => x.args)).toEqual(chrome);
});

test("t767 find: one toolbar button opens the find bar", async () => {
  const c = await pane();
  const finds = find(c, (n) => n.localName === "button" && n.attrs["data-go"] === "find");
  expect(finds).toHaveLength(1);
  expect(find(paneRoot(c), (n) => n === finds[0])).toHaveLength(1);
  await click(c, finds[0]);
  expect(find(c, (n) => n.attrs.role === "search")).toHaveLength(1);
});

test("t767 the find and reload chords press those same toolbar buttons", async () => {
  const c = await pane();
  const root = paneRoot(c);
  // The stand-in DOM has no selector engine: the chord action asks for one data-go button inside the pane.
  (doc as unknown as { querySelector: (s: string) => unknown }).querySelector = (s: string) => {
    const go = /\[data-go="([^"]+)"\]/.exec(s)?.[1];
    const el = go ? button(root, go) : undefined;
    return el && { click: () => void click(c, el) };
  };
  const { action, unmount: stop } = await chordAction();
  await act(async () => {
    action(7, "find");
  });
  expect(find(c, (n) => n.attrs.role === "search")).toHaveLength(1);
  rec.calls = [];
  await act(async () => {
    action(7, "reload");
  });
  expect(sent("browser_go").map((x) => x.args)).toEqual([{ id: 7, what: "reload" }]);
  await stop();
});
