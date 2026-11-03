// T-675 (DT-C111; VIEW-013): the Floor page on the small DOM. A reading that works and then one that fails keeps
// the last lanes on screen, marks them stale (dimmed) and says why; fails when FloorView.tsx drops any of the three.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeNode, find, installDom, mount } from "../tasks/fakeDom";
import { staleNote, type Track } from "./timeline";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(null) }));

const T0 = Date.UTC(2026, 10, 2, 12, 0, 0);
const track: Track = { pane: 7, marks: [{ at: T0 - 10 * 60_000, state: "working" }], ended: null, terminal: 3, live: true };
let root: FakeNode;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date"] });
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  vi.useRealTimers();
});
const pump = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const lanesShown = () => find(root, (n) => n.attrs.class === "floor-lane");

test("T-675 Floor: a re-read that fails after a good one keeps the last lanes, marks them stale and says so", async () => {
  const { doc } = installDom();
  let reads = 0;
  const load = () => (reads++ === 0 ? Promise.resolve([track]) : Promise.reject("the activity log is locked"));
  const { default: FloorView } = await import("./FloorView");
  const m = await mount(createElement(FloorView, { load }), doc);
  unmount = m.unmount;
  root = m.container;
  await pump(0);
  expect(lanesShown()).toHaveLength(1);
  expect(lanesShown()[0].hasAttribute("data-stale")).toBe(false);
  expect(root.textContent).not.toContain(staleNote("x", true)!);

  await pump(5_000); // the next reading fails
  expect(reads).toBe(2);
  expect(lanesShown()).toHaveLength(1);
  expect(lanesShown()[0].textContent).toContain("Terminal 3");
  expect(lanesShown()[0].hasAttribute("data-stale")).toBe(true);
  const note = find(root, (n) => n.attrs.role === "status")[0];
  expect(note?.textContent).toBe(staleNote("x", true));
  expect(root.textContent).toContain("the activity log is locked");
});

test("T-694 (F12): an empty Floor says how an agent gets a lane", async () => {
  const { doc } = installDom();
  const { default: FloorView } = await import("./FloorView");
  const m = await mount(createElement(FloorView, { load: () => Promise.resolve([]) }), doc);
  unmount = m.unmount;
  await pump(0);
  expect(m.container.textContent).toContain("No agent reported any activity in this range. An agent gets a lane here once it runs in a Kolux pane");
});
