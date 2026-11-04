// T-712 (DT-C148): the "Other ways to connect" menu closes on a pick, on Escape and on a click outside it;
// an account row nests no button inside another, and its Remove confirm (the shared Ask) reads Escape as Keep and
// does not remove while the row is busy.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test } from "vitest";
import { type FakeDocument, type FakeNode, byText, click, find, fire, installDom, mount } from "../tasks/fakeDom";
import { OtherWays } from "./ConnectGrid";
import { AccountRow } from "./AccountRow";

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  doc = installDom().doc;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const show = async (el: ReturnType<typeof createElement>) => {
  const m = await mount(el, doc);
  unmount = m.unmount;
  return m.container;
};
const open = async (details: FakeNode) => {
  details.setAttribute("open", "");
  await fire(details, "toggle", details);
};
/** Escape sent through `container`'s listeners; says whether something stopped it (so Settings never sees it). */
const esc = async (container: FakeNode, at: FakeNode) => {
  let stopped = false;
  await fire(container, "keydown", at, { key: "Escape", stopPropagation: () => (stopped = true) });
  return stopped;
};

test("the menu closes on a pick, on Escape and on a click outside it, and stays open for a click inside", async () => {
  const picked: string[] = [];
  const c = await show(createElement(OtherWays, { ways: [{ label: "Sign in with a code", onPick: () => picked.push("code") }] }));
  const details = find(c, (n) => n.localName === "details")[0];
  const item = byText(c, "button", "Sign in with a code")[0];
  // The browser fires toggle when the open attribute goes; the fake DOM does not, so the test does.
  const shutAndListenersGone = async () => {
    expect(details.hasAttribute("open")).toBe(false);
    await fire(details, "toggle", details);
    expect(doc.listeners.keydown ?? []).toHaveLength(0);
    expect(doc.listeners.pointerdown ?? []).toHaveLength(0);
  };

  await open(details);
  await click(c, item);
  expect(picked).toEqual(["code"]);
  await shutAndListenersGone();

  await open(details);
  expect(await esc(doc, item)).toBe(true);
  await shutAndListenersGone();

  await open(details);
  await fire(doc, "pointerdown", find(c, (n) => n.localName === "summary")[0]);
  expect(details.hasAttribute("open")).toBe(true);
  await fire(doc, "pointerdown", doc.body);
  await shutAndListenersGone();
});

test("a shut menu does not listen for Escape, so the key still reaches Settings", async () => {
  const c = await show(createElement(OtherWays, { ways: [{ label: "Sign in with a code", onPick: () => {} }] }));
  expect(doc.listeners.keydown ?? []).toHaveLength(0);
  await open(find(c, (n) => n.localName === "details")[0]);
  expect(doc.listeners.keydown).toHaveLength(1);
});

const row = (busy: boolean, log: string[], confirming = false) =>
  createElement(AccountRow, {
    title: "kim@example.com",
    detail: "Personal",
    active: false,
    busy,
    onPick: () => log.push("pick"),
    manage: { againLabel: "Re-authenticate", onAgain: () => log.push("again"), confirming, activeGoes: false, onAsk: () => log.push("ask"), onRemove: () => log.push("remove"), onKeep: () => log.push("keep") },
  });
const inButton = (n: FakeNode) => {
  for (let p = n.parentNode; p; p = p.parentNode) if (p.localName === "button") return true;
  return false;
};

test("an account row nests no button in another, and its own buttons do not also pick the row", async () => {
  const log: string[] = [];
  const c = await show(row(false, log));
  const buttons = find(c, (n) => n.localName === "button");
  expect(buttons.filter(inButton)).toEqual([]);
  expect(find(c, (n) => n.attrs.role === "button")).toEqual([]);
  const pickBtn = buttons.find((b) => b.attrs["aria-pressed"] === "false")!;
  await click(c, pickBtn);
  await click(c, byText(c, "button", "Remove")[0]);
  await click(c, byText(c, "button", "Re-authenticate")[0]);
  expect(log).toEqual(["pick", "ask", "again"]);
});

test("Escape in the Remove confirm is Keep and goes no further", async () => {
  const log: string[] = [];
  const c = await show(row(false, log, true));
  expect(await esc(c, byText(c, "button", "Keep")[0])).toBe(true);
  expect(log).toEqual(["keep"]);
});

test("the Remove confirm is the shared Ask: titled for the account, Keep and Remove, and Remove does nothing while a sign-in runs (busy)", async () => {
  const log: string[] = [];
  const c = await show(row(true, log, true));
  const confirm = find(c, (n) => n.attrs.role === "alertdialog")[0];
  expect(confirm.attrs["aria-label"]).toBe("Remove kim@example.com?");
  expect(confirm.textContent).toContain("Panes already running keep going.");
  await click(c, byText(confirm, "button", "Remove")[0]);
  expect(log).toEqual([]);
  await click(c, byText(confirm, "button", "Keep")[0]);
  expect(log).toEqual(["keep"]);
});

test("when nothing is busy the confirm's Remove removes", async () => {
  const log: string[] = [];
  const c = await show(row(false, log, true));
  await click(c, byText(find(c, (n) => n.attrs.role === "alertdialog")[0], "button", "Remove")[0]);
  expect(log).toEqual(["remove"]);
});
