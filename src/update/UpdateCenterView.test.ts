// T-675 (DT-C111; APP-025, APP-026): UpdateCenterView's wiring on the APP-024..027 harness, where the helper tests
// (restart.test.ts) cannot reach. A Check after update_status failed ends with the reason instead of spinning, both
// when it was asked before the failure and after it; Escape from the page is Later on the ready pop-up, but while
// the "Restart to update?" question is open it closes only the question (the question's own Escape, T-667). Each test fails when its line in UpdateCenterView.tsx is reverted.
import { act } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, withText } from "../tasks/fakeDom";
import { cardTitle, errorText, feed, info, installUpdateDom, mountCenter, popup, popupButton, pump, sendWindow, sent } from "./__cards__/updateHarness";

const status = vi.hoisted(() => ({ fail: null as string | null, held: null as null | ((why: string) => void) }));
vi.mock("@tauri-apps/api/core", async () => {
  const { coreMock, feed } = await import("./__cards__/updateHarness");
  return {
    invoke: (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd !== "update_status" || status.fail === null) return coreMock.invoke(cmd, args);
      feed.calls.push({ cmd, args });
      if (status.fail === "hold") return new Promise((_ok, no) => (status.held = no));
      return Promise.reject(status.fail);
    },
  };
});
vi.mock("@tauri-apps/api/event", async () => (await import("./__cards__/updateHarness")).eventMock);

const REASON = "the update store could not be read";
let doc: FakeDocument;
let root: FakeNode;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installUpdateDom();
  status.fail = null;
  status.held = null;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  vi.useRealTimers();
});
async function start() {
  const m = await mountCenter(doc);
  unmount = m.unmount;
  root = m.container;
}
const check = () => sendWindow("kolux-check-updates");
/** A key the page itself gets (nothing inside it has focus), sent to the window as the browser would. A popup's
 * Escape watcher stops and prevents the key, so the event has both. */
async function pageKey(key: string) {
  const e = { type: "keydown", key, defaultPrevented: false, target: doc.body, stopPropagation: () => {}, preventDefault: () => (e.defaultPrevented = true) };
  await act(async () => {
    (globalThis as unknown as { window: Window }).window.dispatchEvent(e as unknown as Event);
  });
}

test("T-675 update: a Check asked before update_status answers waits, and ends with the reason when the status fails", async () => {
  status.fail = "hold";
  await start();
  await check();
  expect(cardTitle(doc.body)).toBe("Checking for updates…");
  await act(async () => status.held?.(REASON));
  await pump(0);
  expect(cardTitle(doc.body)).not.toBe("Checking for updates…");
  expect(errorText(doc.body).join(" ")).toContain(REASON);
  expect(sent("update_check")).toHaveLength(0);
});

test("T-675 update: a Check after update_status failed fails at once with the reason", async () => {
  status.fail = REASON;
  await start();
  await check();
  expect(cardTitle(doc.body)).not.toBe("Checking for updates…");
  expect(errorText(doc.body).join(" ")).toContain(REASON);
  expect(sent("update_check")).toHaveLength(0);
});

test("T-675 update: Escape from the page is Later on the ready pop-up, and while Restart to update? is open it closes only the question", async () => {
  feed.status.lastCheckAt = 0;
  feed.latest = info("0.2.0");
  await start();
  expect(popup(doc.body)).not.toBeNull();
  await click(root, popupButton(doc.body, "Update now"));
  expect(withText(doc.body, "h2", "Restart to update?")).toHaveLength(1);
  await pageKey("Escape"); // the question is open: Escape closes the question, the pop-up stays
  expect(withText(doc.body, "h2", "Restart to update?")).toHaveLength(0);
  expect(popup(doc.body)).not.toBeNull();
  await pageKey("Escape"); // now it is Later
  expect(popup(doc.body)).toBeNull();
  expect(sent("update_restart")).toHaveLength(0);
});
