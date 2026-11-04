// T-764 / T-734 (#194 b): a finished download row shows Open and Show in folder; Show in folder asks the backend to
// reveal that download (by its key). A running one shows Cancel and no Show in folder.
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, find, type FakeNode } from "../tasks/fakeDom";
import { installPaneDom, mountPane, rec, sent } from "./__cards__/paneHarness";

vi.mock("@tauri-apps/api/core", async () => ({ invoke: (await import("./__cards__/paneHarness")).coreMock.invoke }));
vi.mock("@tauri-apps/api/event", async () => (await import("./__cards__/paneHarness")).eventMock);
vi.mock("@tauri-apps/api/webview", async () => (await import("./__cards__/paneHarness")).webviewMock);
vi.mock("@tauri-apps/plugin-dialog", async () => (await import("./__cards__/paneHarness")).dialogMock);
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isFocused: () => Promise.resolve(true) }) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installPaneDom();
  (doc as unknown as { hasFocus: () => boolean }).hasFocus = () => false;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const download = (state: string, key = 41) => ({ id: 7, key, url: "https://x.example/f.txt", name: "f.txt", path: state === "done" ? "D:/Downloads/f.txt" : "", received: 10, total: 10, state });
async function raise(payload: Record<string, unknown>) {
  await act(async () => {
    rec.handlers.get("browser-download")?.({ payload });
  });
}
const labels = (c: FakeNode) => find(c, (n) => n.localName === "button").map((n) => n.attrs["aria-label"]).filter(Boolean);

test("T-734: a finished download shows Open and Show in folder, and Show in folder asks the backend to reveal that download", async () => {
  const m = await mountPane(doc);
  unmount = m.unmount;
  await raise(download("done"));
  expect(labels(m.container)).toEqual(expect.arrayContaining(["Open f.txt", "Show in folder: f.txt", "Dismiss"]));
  const reveal = find(m.container, (n) => n.attrs["aria-label"] === "Show in folder: f.txt")[0];
  await click(m.container, reveal);
  expect(sent("browser_download_reveal").map((c) => c.args)).toEqual([{ key: 41 }]);
});

test("T-734: a running download offers Cancel and no Show in folder or Open", async () => {
  const m = await mountPane(doc);
  unmount = m.unmount;
  await raise(download("running"));
  const l = labels(m.container);
  expect(l).toContain("Cancel: f.txt");
  expect(l.some((x) => String(x).startsWith("Show in folder"))).toBe(false);
  expect(l.some((x) => String(x).startsWith("Open"))).toBe(false);
});
