// @vitest-environment happy-dom
// T-757 (DT-C193): the Routing provider tabs are a real tab set (src/ui Tabs): the open tab is the one tab stop and
// labels the panel below, and Left, Right, Home and End move along the tabs and open the one reached.
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { find, fire, installDom, mount, settle, type FakeNode } from "../tasks/realDom";
import RoutingPage from "./RoutingPage";
import type { Provider } from "./routing";

const providers: Provider[] = [
  { id: "claude", name: "Claude Code", models: [], defaults: [] },
  { id: "codex", name: "Codex", models: [], defaults: [] },
  { id: "gemini", name: "Gemini", models: [], defaults: [] },
];

let unmount: () => Promise<void> = async () => {};
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const role = (c: FakeNode, r: string) => find(c, (n) => n.getAttribute("role") === r);
const open = (c: FakeNode) => role(c, "tab").find((t) => t.getAttribute("aria-selected") === "true")!;
/** A key pressed on the focused tab, as the keyboard sends it. */
const key = async (c: FakeNode, k: string) => {
  await fire(c, "keydown", document.activeElement!, { key: k });
  await settle();
};

test("the provider tabs move with the arrow keys and the open tab labels the panel", async () => {
  installDom();
  const m = await mount(createElement(RoutingPage, { agents: [], settings: {}, onSettings: () => {}, initial: providers }));
  unmount = m.unmount;
  await settle();
  const c = m.container;
  const tabs = role(c, "tab");
  expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  const panel = role(c, "tabpanel");
  expect(panel).toHaveLength(1);
  expect(open(c).getAttribute("aria-controls")).toBe(panel[0].id);
  expect(panel[0].getAttribute("aria-labelledby")).toBe(open(c).id);

  open(c).focus();
  await key(c, "ArrowRight");
  expect(open(c).textContent).toContain("Codex");
  await key(c, "End");
  expect(open(c).textContent).toContain("Gemini");
  await key(c, "ArrowRight"); // wraps to the first
  expect(open(c).textContent).toContain("Claude Code");
  await key(c, "ArrowLeft");
  expect(open(c).textContent).toContain("Gemini");
  expect(role(c, "tabpanel")[0].getAttribute("aria-labelledby")).toBe(open(c).id);
  expect(document.activeElement).toBe(open(c));
});
