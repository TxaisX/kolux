// T-712 (DT-C148): the "Other ways to connect" menu closes on a pick, on Escape and on a click outside it;
// an account row nests no button inside another, and its Remove confirm reads Escape as Keep and is
// disabled while the row is busy.
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
const esc = (at: FakeNode) => fire(doc, "keydown", at, { key: "Escape" });

test("the menu closes on a pick, on Escape and on a click outside it, and stays open for a click inside", async () => {
  const picked: string[] = [];
  const c = await show(createElement(OtherWays, { ways: [{ label: "Sign in with a code", onPick: () => picked.push("code") }] }));
  const details = find(c, (n) => n.localName === "details")[0];
  const item = byText(c, "button", "Sign in with a code")[0];

  await open(details);
  await click(c, item);
  expect(picked).toEqual(["code"]);
  expect(details.hasAttribute("open")).toBe(false);

  await open(details);
  await esc(item);
  expect(details.hasAttribute("open")).toBe(false);

  await open(details);
  await fire(doc, "pointerdown", find(c, (n) => n.localName === "summary")[0]);
  expect(details.hasAttribute("open")).toBe(true);
  await fire(doc, "pointerdown", doc.body);
  expect(details.hasAttribute("open")).toBe(false);
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

test("the Remove confirm reads Escape as Keep", async () => {
  const log: string[] = [];
  const c = await show(row(false, log, true));
  await esc(c);
  expect(log).toEqual(["keep"]);
});

test("while the row is busy, Remove and Keep are disabled and Escape keeps nothing", async () => {
  const log: string[] = [];
  const c = await show(row(true, log, true));
  const confirm = find(c, (n) => n.attrs.role === "alertdialog")[0];
  for (const b of find(confirm, (n) => n.localName === "button")) expect(b.attrs.disabled).toBeDefined();
  await esc(c);
  expect(log).toEqual([]);
});
