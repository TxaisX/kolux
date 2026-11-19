// SET-034 / SET-036: the volume slider saves once, when it is let go, not on every step of the drag,
// and leaving the page with it moved saves it too. Audit N-52: this page's real logic had no test.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fire, type FakeDocument, type FakeNode, find, installDom, mount, settle, typeInto } from "../test/fakeDom";

const h = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    h.calls.push(cmd);
    return Promise.resolve(cmd === "tray_close_switch_available" ? false : null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  h.calls.length = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function page(settings: Record<string, unknown>, onSave: (p: Record<string, unknown>) => void): Promise<FakeNode> {
  const { NotificationsView } = await import("./NotificationsPage");
  const m = await mount(createElement(NotificationsView, { settings, onSave }), doc);
  unmount = m.unmount;
  await settle();
  return m.container as FakeNode;
}

const volumeOf = (c: FakeNode) => find(c, (n) => n.attrs["aria-label"] === "Volume")[0];

test("the volume saves once when the slider is let go, not on every step of the drag", async () => {
  const saves: Array<Record<string, unknown>> = [];
  const c = await page({ notificationsOn: true, notificationVolume: 50 }, (p) => saves.push(p));
  const slider = volumeOf(c);
  await typeInto(c, slider, "40");
  await typeInto(c, slider, "30");
  expect(saves).toEqual([]); // a drag in progress writes nothing
  await fire(c, "pointerup", slider);
  expect(saves).toEqual([{ notificationVolume: 30 }]);
});

test("an untouched slider saves nothing when the page is left", async () => {
  const saves: Array<Record<string, unknown>> = [];
  const c = await page({ notificationsOn: true, notificationVolume: 50 }, (p) => saves.push(p));
  await fire(c, "pointerup", volumeOf(c));
  expect(saves).toEqual([]);
});

test("the test button asks the window for a sample notification with the chosen sound", async () => {
  const c = await page({ notificationsOn: true, notificationVolume: 50 }, () => {});
  const button = find(c, (n) => n.localName === "button" && n.textContent.trim() === "Send a test notification")[0];
  await fire(c, "click", button);
  await settle();
  expect(h.calls).toContain("notification_test");
});
