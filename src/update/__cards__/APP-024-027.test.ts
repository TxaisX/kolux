// APP-024..027 on the real UpdateCenter (real UpdateSchedule and card reducer) under fake time. Only the back end is
// scripted (updateHarness.ts feed): whether the real updater finds, downloads and installs a release is LIVE.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, fire, withText } from "../../tasks/fakeDom";
import { byTitle, card, cardTitle, errorText, feed, info, installUpdateDom, mountCenter, notes, online, popup, popupButton, popupText as noticeText, pump, sendWindow, sent } from "./updateHarness";

vi.mock("@tauri-apps/api/core", async () => (await import("./updateHarness")).coreMock);
vi.mock("@tauri-apps/api/event", async () => (await import("./updateHarness")).eventMock);

const MIN = 60_000;
let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let root: FakeNode;
beforeEach(() => {
  doc = installUpdateDom();
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  vi.useRealTimers();
});
const start = async () => {
  const m = await mountCenter(doc);
  unmount = m.unmount;
  root = m.container;
  return m;
};

describe("APP-024", () => {
  test("box 1: a release published with the app open is downloaded by the next half-hour check, with no click", async () => {
    await start();
    expect(sent("update_check")).toHaveLength(0); // just checked: waits out the remainder
    await pump(5 * MIN);
    feed.latest = info("0.2.0"); // published 5 minutes in
    await pump(24 * MIN);
    expect(sent("update_download")).toHaveLength(0); // 29 minutes: not yet
    await pump(1 * MIN + 1000);
    expect(sent("update_check")).toHaveLength(1);
    expect(sent("update_download")).toHaveLength(1); // 25 minutes after the publish, no click anywhere
    expect(noticeText(doc.body)).toBe("A new Kolux RS version is out on GitHub. Version 0.2.0."); // the one notice (APP-025)
    expect(card(doc.body)).toBeNull(); // quiet: no card
    expect(sent("update_restart")).toHaveLength(0);
  });

  test("a quiet check shows nothing while it checks or downloads; the notice comes only once the download is ready", async () => {
    feed.status.lastCheckAt = 0; // a quiet check runs at start
    feed.latest = info("0.2.0");
    feed.holdDownload = true;
    await start();
    expect(sent("update_check")).toHaveLength(1);
    expect(sent("update_download")).toHaveLength(1);
    expect(card(doc.body)).toBeNull();
    expect(popup(doc.body)).toBeNull();
    feed.release?.();
    await pump(0);
    expect(noticeText(doc.body)).toBe("A new Kolux RS version is out on GitHub. Version 0.2.0.");
  });

  test("box 2: an hour with no connection shows nothing; the check runs within a minute of its return", async () => {
    feed.status.lastCheckAt = 0; // long overdue at launch
    online(false);
    await start();
    await pump(60 * MIN);
    expect(sent("update_check")).toHaveLength(0);
    expect(card(doc.body)).toBeNull();
    expect(popup(doc.body)).toBeNull();
    expect(errorText(doc.body)).toEqual([]);
    online(true);
    await sendWindow("online");
    await pump(60_000);
    expect(sent("update_check")).toHaveLength(1);
    expect(card(doc.body)).toBeNull();
    expect(errorText(doc.body)).toEqual([]);
  });

  test("box 2 (connection flag up, requests failing): the failure is silent and the retry comes an hour later", async () => {
    feed.status.lastCheckAt = 0;
    feed.checkError = "error sending request for url (https://example.invalid/latest.json)";
    await start();
    expect(sent("update_check")).toHaveLength(1);
    expect(card(doc.body)).toBeNull();
    expect(errorText(doc.body)).toEqual([]);
    await pump(59 * MIN);
    expect(sent("update_check")).toHaveLength(1);
    await pump(2 * MIN);
    expect(sent("update_check")).toHaveLength(2);
    expect(card(doc.body)).toBeNull();
  });
});

describe("APP-025", () => {
  test("box 1: the ready pop-up appears once; closed, it does not come back this launch; nothing restarts by itself", async () => {
    feed.status.lastCheckAt = T_OLD;
    feed.latest = info("0.2.0");
    await start();
    expect(sent("update_download")).toHaveLength(1);
    expect(popup(doc.body)).not.toBeNull();
    expect(noticeText(doc.body)).toBe("A new Kolux RS version is out on GitHub. Version 0.2.0.");
    expect(popupButton(doc.body, "Update now")).toBeDefined();
    expect(popupButton(doc.body, "Later")).toBeDefined();
    expect(popup(doc.body)!.attrs["aria-label"]).toBe("Update available");
    expect(card(doc.body)).toBeNull();
    await pump(31 * MIN); // another quiet check finds the same version while the pop-up is open
    expect(doc.body.textContent.split("A new Kolux RS version is out on GitHub.").length - 1).toBe(1);
    await click(root, popupButton(doc.body, "Later"));
    expect(popup(doc.body)).toBeNull();
    await pump(95 * MIN); // three more quiet checks
    expect(sent("update_check").length).toBeGreaterThanOrEqual(4);
    expect(popup(doc.body)).toBeNull();
    expect(sent("update_restart")).toHaveLength(0);
    expect(sent("update_mark").some((c) => c.args.key === "dismissedVersion")).toBe(false); // per launch, nothing persisted
  });

  test("Update now is the restart-to-update action", async () => {
    feed.status.lastCheckAt = T_OLD;
    feed.latest = info("0.2.0");
    await start();
    expect(sent("update_restart")).toHaveLength(0);
    await click(root, popupButton(doc.body, "Update now"));
    // Restarting ends every terminal and agent, so it asks first; nothing restarts until the user agrees.
    expect(sent("update_restart")).toHaveLength(0);
    expect(withText(doc.body, "h2", "Restart to update?")).toHaveLength(1);
    await click(root, withText(doc.body, "button", "Restart now")[0]);
    expect(sent("update_restart")).toHaveLength(1);
    expect(popupButton(doc.body, "Restarting…")).toBeDefined();
  });

  test("Later closes the notice for this launch only; a new launch offers it again, and nothing is remembered", async () => {
    feed.status.lastCheckAt = T_OLD;
    feed.latest = info("0.2.0");
    await start();
    await click(root, popupButton(doc.body, "Later"));
    expect(popup(doc.body)).toBeNull();
    expect(sent("update_restart")).toHaveLength(0);
    await unmount();
    feed.status.ready = info("0.2.0"); // the next launch finds it downloaded
    await start();
    expect(noticeText(doc.body)).toContain("Version 0.2.0.");
  });

  test("Escape on the notice is Later; Enter on its container starts nothing", async () => {
    feed.status.lastCheckAt = T_OLD;
    feed.latest = info("0.2.0");
    await start();
    await fire(root, "keydown", popup(doc.body)!, { key: "Enter" });
    expect(sent("update_restart")).toHaveLength(0);
    expect(popup(doc.body)).not.toBeNull();
    await fire(root, "keydown", popup(doc.body)!, { key: "Escape" });
    expect(popup(doc.body)).toBeNull();
    expect(sent("update_restart")).toHaveLength(0);
  });

  test("rule: the pop-up stays silent while the card shows that same update", async () => {
    feed.latest = info("0.2.0");
    await start();
    await sendWindow("kolux-check-updates");
    expect(cardTitle(doc.body)).toBe("Kolux RS 0.2.0 is ready");
    expect(popup(doc.body)).toBeNull();
  });
});

const T_OLD = 0;

describe("APP-026", () => {
  test("box 1: Check for Updates on the newest version says up to date, then the card closes itself", async () => {
    await start();
    await sendWindow("kolux-check-updates"); // what Help and the command palette dispatch (requestUpdateCheck)
    expect(sent("update_check")).toHaveLength(1);
    expect(cardTitle(doc.body)).toBe("Kolux RS is up to date");
    await pump(3000);
    expect(card(doc.body)).toBeNull();
  });

  test("box 1 rule: a second click during a running check does not start a second one", async () => {
    feed.holdCheck = true;
    await start();
    await sendWindow("kolux-check-updates");
    await sendWindow("kolux-check-updates"); // first check still running
    expect(sent("update_check")).toHaveLength(1);
    feed.releaseCheck?.();
    await pump(0);
    expect(cardTitle(doc.body)).toBe("Kolux RS is up to date");
    expect(sent("update_check")).toHaveLength(1);
  });

  test("box 2: a dismissed version stays away through quiet checks; a newer one brings the card back", async () => {
    feed.latest = info("0.2.0");
    await start();
    await sendWindow("kolux-check-updates");
    expect(cardTitle(doc.body)).toBe("Kolux RS 0.2.0 is ready");
    await click(root, byTitle(doc.body, "Dismiss"));
    expect(card(doc.body)).toBeNull();
    expect(sent("update_mark").some((c) => c.args.key === "dismissedVersion" && c.args.value === "0.2.0")).toBe(true);
    await pump(95 * MIN); // quiet checks keep finding 0.2.0
    expect(sent("update_check").length).toBeGreaterThanOrEqual(4);
    expect(card(doc.body)).toBeNull();
    feed.latest = info("0.3.0"); // published
    await sendWindow("kolux-check-updates");
    expect(card(doc.body)).not.toBeNull();
    expect(cardTitle(doc.body)).toContain("0.3.0");
  });

  test("DT-APP-026: background checks keep the dismissed version hidden; an explicit Check for Updates shows it", async () => {
    feed.latest = info("0.2.0");
    await start();
    await sendWindow("kolux-check-updates");
    await click(root, byTitle(doc.body, "Dismiss"));
    expect(card(doc.body)).toBeNull();
    await pump(95 * MIN); // background: the same 0.2.0 stays hidden
    expect(sent("update_check").length).toBeGreaterThanOrEqual(4);
    expect(card(doc.body)).toBeNull();
    await sendWindow("kolux-check-updates"); // requested: the same 0.2.0 shows
    expect(card(doc.body)).not.toBeNull();
    expect(cardTitle(doc.body)).toContain("0.2.0");
  });
});

describe("APP-027", () => {
  test("box 1: the five bullets of a release's notes are listed in the card, through ready, and cleared by a new check", async () => {
    const five = ["Faster start", "Sturdier panes", "Fixed the tab bar", "New update card", "Smaller installer"];
    feed.latest = info("0.2.0", five);
    feed.holdDownload = true;
    await start();
    await sendWindow("kolux-check-updates");
    expect(cardTitle(doc.body)).toBe("Downloading Kolux RS 0.2.0");
    expect(notes(doc.body)).toEqual(five);
    feed.release?.();
    await pump(0);
    expect(cardTitle(doc.body)).toBe("Kolux RS 0.2.0 is ready");
    expect(notes(doc.body)).toEqual(five);
    feed.latest = null; // a new check begins and finds nothing newer than the app
    feed.holdDownload = false;
    await sendWindow("kolux-check-updates");
    expect(notes(doc.body)).toEqual([]);
  });

  test("box 2: with no notes the card still appears and the update still installs", async () => {
    feed.latest = info("0.2.0", []); // the manifest carried none (or they could not be read)
    await start();
    await sendWindow("kolux-check-updates");
    expect(cardTitle(doc.body)).toBe("Kolux RS 0.2.0 is ready");
    expect(notes(doc.body)).toEqual([]);
    await click(root, withText(doc.body, "button", "Restart to update")[0]);
    await click(root, withText(doc.body, "button", "Restart now")[0]);
    expect(sent("update_restart")).toHaveLength(1);
  });
});
