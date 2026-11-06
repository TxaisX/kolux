// T-600 (F02-settings-update.1; APP-026): the update card takes the keyboard only on the user's own click, and a bare
// Enter never restarts Kolux from a card the user did not open. The real UpdateCenter (real schedule and card reducer)
// under fake time, on the APP-024..027 harness; focus is tracked, and `enter` sends the user's next Enter wherever the
// keyboard is: on the card it is the card's Enter, anywhere else (a terminal) the card never sees it.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, FakeNode, fire, withText } from "../tasks/fakeDom";
import { card, cardTitle, feed, info, installUpdateDom, mountCenter, pump, sendWindow, sent } from "./__cards__/updateHarness";

const fail = vi.hoisted(() => ({ download: false }));
vi.mock("@tauri-apps/api/core", async () => {
  const { coreMock, feed } = await import("./__cards__/updateHarness");
  return {
    invoke: (cmd: string, args: Record<string, unknown> = {}) => {
      if (cmd !== "update_download" || !fail.download) return coreMock.invoke(cmd, args);
      feed.calls.push({ cmd, args });
      return Promise.reject("error sending request for url (https://example.invalid/kolux.exe)");
    },
  };
});
vi.mock("@tauri-apps/api/event", async () => (await import("./__cards__/updateHarness")).eventMock);

const MIN = 60_000;
let doc: FakeDocument;
let root: FakeNode;
let terminal: FakeNode;
let unmount: () => Promise<void> = async () => {};
const realFocus = FakeNode.prototype.focus;
beforeEach(() => {
  doc = installUpdateDom();
  FakeNode.prototype.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  terminal = doc.createElement("textarea"); // an agent's terminal, where the user types
  doc.body.appendChild(terminal);
  terminal.focus();
  fail.download = false;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  FakeNode.prototype.focus = realFocus;
  vi.useRealTimers();
});
async function start() {
  const m = await mountCenter(doc);
  unmount = m.unmount;
  root = m.container;
}
const press = (key: string) => fire(root, "keydown", card(doc.body)!, { key });
/** The user's next Enter: the card's only when the keyboard is on the card. */
const enter = async () => {
  if (doc.activeElement === card(doc.body)) await press("Enter");
};
/** Where the keyboard is. */
const keys = () => (doc.activeElement === terminal ? "terminal" : doc.activeElement === card(doc.body) ? "card" : "elsewhere");
const collapsed = () => /\bcollapsed\b/.test(card(doc.body)?.attrs.class ?? "");

test("rule 4: Check for updates gives the card the keyboard; a later change of phase never takes it back from the terminal", async () => {
  feed.latest = info("0.2.0");
  feed.holdDownload = true;
  await start();
  await sendWindow("kolux-check-updates"); // the user's click
  expect(cardTitle(doc.body)).toBe("Downloading Kolux 0.2.0");
  expect(keys()).toBe("card");
  terminal.focus(); // back to typing to an agent
  feed.release?.(); // the download finishes
  await pump(0);
  expect(cardTitle(doc.body)).toBe("Kolux 0.2.0 is ready");
  expect(keys()).toBe("terminal");
  await enter();
  expect(sent("update_restart")).toHaveLength(0);
});

test("Trigger A: after Check and a collapse, the half-hourly check neither reopens the card nor takes the keyboard", async () => {
  feed.latest = info("0.2.0");
  await start();
  await sendWindow("kolux-check-updates");
  expect(cardTitle(doc.body)).toBe("Kolux 0.2.0 is ready");
  await press("Escape"); // collapse
  expect(collapsed()).toBe(true);
  terminal.focus();
  await pump(31 * MIN); // the quiet check finds the same version
  expect(sent("update_check")).toHaveLength(2);
  expect(collapsed()).toBe(true);
  expect(keys()).toBe("terminal");
  await enter();
  await pump(31 * MIN); // and again
  await enter();
  expect(collapsed()).toBe(true);
  expect(sent("update_restart")).toHaveLength(0);
});

test("Trigger B and rule 5: a background download error brings the card up without the keyboard; Enter restarts only once the user opens it", async () => {
  feed.status.lastCheckAt = 0; // a quiet check runs at start
  feed.latest = info("0.2.0");
  fail.download = true;
  await start();
  expect(cardTitle(doc.body)).toBe("Kolux 0.2.0 did not download"); // download errors bring the card up (APP-026)
  expect(keys()).toBe("terminal");
  fail.download = false;
  await pump(31 * MIN); // the next quiet check gets it ready on the card that opened itself
  expect(cardTitle(doc.body)).toBe("Kolux 0.2.0 is ready");
  expect(keys()).toBe("terminal");
  card(doc.body)!.focus(); // even with the keyboard on it (a click on the card), a bare Enter does not restart
  await press("Enter");
  expect(sent("update_restart")).toHaveLength(0);
  await sendWindow("kolux-update-show"); // the user opens it from the status bar
  expect(keys()).toBe("card");
  await enter();
  expect(sent("update_restart")).toHaveLength(0); // Enter asks first
  await click(root, withText(doc.body, "button", "Restart now")[0]);
  expect(sent("update_restart")).toHaveLength(1);
});

test("rule 5 positive: on a card the user opened with Check for updates, Enter runs Restart (APP-026)", async () => {
  feed.latest = info("0.2.0");
  await start();
  await sendWindow("kolux-check-updates");
  expect(cardTitle(doc.body)).toBe("Kolux 0.2.0 is ready");
  await enter();
  expect(sent("update_restart")).toHaveLength(0); // Enter asks first
  await click(root, withText(doc.body, "button", "Restart now")[0]);
  expect(sent("update_restart")).toHaveLength(1);
});

test("rule 4: a status-bar click with nothing to show leaves no claim on the keyboard for a card that comes up later", async () => {
  feed.latest = info("0.2.0");
  fail.download = true;
  await start();
  await sendWindow("kolux-update-show"); // nothing to show yet: the card stays away
  expect(card(doc.body)).toBeNull();
  terminal.focus();
  feed.status.lastCheckAt = 0;
  await pump(31 * MIN); // a quiet check, then a download error brings the card up by itself
  expect(cardTitle(doc.body)).toBe("Kolux 0.2.0 did not download");
  expect(keys()).toBe("terminal");
});
