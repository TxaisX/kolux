// @vitest-environment happy-dom
// T-599 (F08-onboarding-look-misc.1; APP-042, PROJ-089): the crash screen never reloads while a report is being
// written. The watch in recovery.rs reloads a page that sends no heartbeat for STALL (20 s); the crash screen replaces
// App, and with it RecoveryMount's heartbeat. The real ScreenBoundary, its Report button and the Send Feedback box run
// on the small DOM under fake timers; `reloaded` applies the watch's rule (Interface::tick, Live phase) to the beats sent.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byText, click, type FakeDocument, type FakeNode, find, installDom, mount } from "../tasks/realDom";

const h = vi.hoisted(() => ({ beats: [] as number[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "ui_heartbeat") return (h.beats.push(Date.now()), Promise.resolve());
    if (cmd === "app_info") return Promise.resolve({ version: "0.1.0" });
    if (cmd === "feedback_facts") return Promise.resolve({ release: "10.0.26100", arch: "x86_64", login: null });
    return Promise.reject("not stubbed");
  },
}));

/** recovery.rs STALL: a page silent this long is reloaded. */
const STALL = 20_000;
/** Whether the watch would have reloaded the page between `from` and `to`. */
const reloaded = (from: number, to: number) => {
  let last = from;
  for (const t of [...h.beats.filter((b) => b >= from && b <= to), to]) {
    if (t - last >= STALL) return true;
    last = t;
  }
  return false;
};

let doc: FakeDocument;
let broken = true;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  const dom = installDom();
  doc = dom.doc;
  vi.spyOn(console, "error").mockImplementation(() => {}); // React reports the render error the boundary catches
  h.beats = [];
  broken = true;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Time passes; the commands' promises and React's updates run as they would. */
const run = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function Board() {
  if (broken) throw new Error("the board drew a card that is gone");
  return createElement("p", null, "workspace");
}

async function crashed() {
  const { default: ScreenBoundary } = await import("./ScreenBoundary");
  const m = await mount(createElement(ScreenBoundary, null, createElement(Board)), doc);
  unmount = m.unmount;
  expect(m.container.textContent).toContain("Kolux hit a problem");
  // The box's code is read when the crash screen draws (it is not in the first load); wait for it, as a person's click always does.
  await act(async () => void (await vi.dynamicImportSettled()));
  return m.container;
}
const box = (c: FakeNode) => find(c, (n) => n.localName === "textarea" && n.attrs["aria-label"] === "Your feedback")[0];
/** What the box shows: React fills a new textarea through defaultValue, which this small DOM keeps as it is. */
const shown = (n: FakeNode) => n.value || String(n.defaultValue ?? "");

test("the crash screen alone is still recovered by the watch: no heartbeat, so it reloads after 20 s (T-183)", async () => {
  await crashed();
  const from = Date.now();
  await run(25_000);
  expect(h.beats).toEqual([]);
  expect(reloaded(from, Date.now())).toBe(true);
});

test("once Report is opened the page stays alive while the report is open or has text, so the box and the error stay", async () => {
  const c = await crashed();
  await run(5_000);
  const from = Date.now();
  await click(c, byText(c, "button", "Report")[0]);
  await run(0);
  expect(shown(box(c))).toContain("Error: Error: the board drew a card that is gone");
  await run(90_000); // writing the report
  expect(reloaded(from, Date.now())).toBe(false);
  // Closed unsent, the box keeps its text (PROJ-089), so the page stays alive.
  await click(c, byText(c, "button", "Cancel")[0]);
  await run(90_000);
  expect(reloaded(from, Date.now())).toBe(false);
  expect(c.textContent).toContain("Kolux hit a problem");
  await click(c, byText(c, "button", "Report")[0]);
  await run(0);
  expect(shown(box(c))).toContain("What I was doing:");
});

test("leaving the crash screen with Try again stops its heartbeat (App's own takes over)", async () => {
  const c = await crashed();
  await click(c, byText(c, "button", "Report")[0]);
  await run(10_000);
  expect(h.beats.length).toBeGreaterThan(0);
  broken = false;
  await click(c, byText(c, "button", "Try again")[0]);
  expect(c.textContent).toContain("workspace");
  const sent = h.beats.length;
  await run(30_000);
  expect(h.beats.length).toBe(sent);
});
