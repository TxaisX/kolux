// T-695 (S33): the Help sheet drawn for real (fakeDom + React), its controls clicked. helpItems.test.ts
// covers the list as data; this checks the sheet: what it shows, that each kind of item does its job and
// closes the sheet (or stays open where it says so), and that Escape and the backdrop close it.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byText, click, type FakeDocument, type FakeNode, find, fire, installDom, mount, until } from "../tasks/fakeDom";

const spy = vi.hoisted(() => ({ calls: [] as string[], invoked: [] as [string, unknown][] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    spy.invoked.push([cmd, args]);
    return Promise.resolve(cmd === "diag_summary" ? "diag text" : null);
  },
}));
vi.mock("./Guides", () => ({ useGuideState: () => ({ done: new Set() }), Ring: () => null }));
vi.mock("./guide", async (orig) => ({
  ...(await orig<typeof import("./guide")>()),
  openGuide: () => spy.calls.push("guide"),
  openExplore: () => spy.calls.push("explore"),
}));
vi.mock("./tour", async (orig) => ({ ...(await orig<typeof import("./tour")>()), replayTour: (id: string) => spy.calls.push("tour:" + id) }));
vi.mock("../settings/pages", () => ({ openSettings: (p: string) => spy.calls.push("settings:" + p) }));
vi.mock("../feedback/FeedbackDialog", () => ({ requestFeedback: () => spy.calls.push("feedback") }));
vi.mock("../update/UpdateCenter", () => ({ requestUpdateCheck: () => spy.calls.push("updates") }));

let doc: FakeDocument;
let root: FakeNode;
let closed = 0;
let unmount: () => Promise<void> = async () => {};

beforeEach(async () => {
  doc = installDom().doc;
  Object.assign(spy, { calls: [], invoked: [] });
  closed = 0;
  const { default: HelpSheet } = await import("./HelpSheet");
  const m = await mount(createElement(HelpSheet, { at: { bottom: 40, left: 8 }, onClose: () => void closed++ }), doc);
  unmount = m.unmount;
  root = m.container;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const menu = () => find(root, (n) => n.attrs.role === "menu")[0];
const item = (label: string) => {
  const hit = find(root, (n) => n.attrs.role === "menuitem" && n.textContent.startsWith(label));
  expect(hit, label).toHaveLength(1);
  return hit[0];
};

test("T-695 help sheet (S33): a menu labelled Help lists Settings, the Help group and every tour by name", async () => {
  expect(menu().attrs["aria-label"]).toBe("Help");
  const { TOURS } = await import("./tour");
  const labels = find(root, (n) => n.attrs.role === "menuitem").map((n) => n.textContent);
  expect(labels[0]).toBe("Settings");
  for (const l of ["Docs", "Changelog", "GitHub", "Milestones", "Keyboard Shortcuts", "Send Feedback", "Check for Updates", "Restart Kolux"]) item(l);
  for (const t of TOURS.filter((t) => t.id !== "grid")) item(t.name);
  expect(byText(root, "div", "Help")).toHaveLength(1);
  expect(byText(root, "div", "Tours")).toHaveLength(1);
});

test("T-695 help sheet (S33): each item does its job and closes the sheet", async () => {
  const { DOCS_URL } = await import("./links");
  const { TOURS } = await import("./tour");
  const tour = TOURS.find((t) => t.id !== "grid")!;
  const cases: [string, () => void][] = [
    ["Settings", () => expect(spy.calls).toEqual(["settings:general"])],
    ["Keyboard Shortcuts", () => expect(spy.calls).toEqual(["settings:shortcuts"])],
    ["Docs", () => expect(spy.invoked).toContainEqual(["open_external", { url: DOCS_URL }])],
    ["Send Feedback", () => expect(spy.calls).toEqual(["feedback"])],
    ["Check for Updates", () => expect(spy.calls).toEqual(["updates"])],
    [tour.name, () => expect(spy.calls).toEqual(["tour:" + tour.id])],
  ];
  for (const [label, check] of cases) {
    Object.assign(spy, { calls: [], invoked: [] });
    const before = closed;
    await click(root, item(label));
    check();
    expect(closed, label + " closes the sheet").toBe(before + 1);
  }
});

test("T-695 help sheet (S33): Copy terminal diagnostics keeps the sheet open and says what happened", async () => {
  await click(root, item("Copy terminal diagnostics"));
  await until(() => find(root, (n) => n.attrs.role === "status").length === 1, "the diagnostics note");
  expect(spy.invoked.map(([c]) => c)).toEqual(["diag_summary", "clip_copy_text"]);
  expect(closed).toBe(0);
});

test("T-695 help sheet (S33): Escape and a click on the backdrop close it", async () => {
  await fire(root, "keydown", item("Settings"), { key: "Escape" });
  expect(closed).toBe(1);
  await click(root, find(root, (n) => n.attrs.class === "menu-backdrop")[0]);
  expect(closed).toBe(2);
});
