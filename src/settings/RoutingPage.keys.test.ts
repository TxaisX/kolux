// T-757 (DT-C193): the Routing provider tabs are a real tab set: the open tab is the one tab stop and controls
// the panel below, and Left, Right, Home and End move along the tabs and open the one reached.
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";
import { find, fire, installDom, mount, type FakeNode } from "../tasks/fakeDom";
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

const role = (c: FakeNode, r: string) => find(c, (n) => n.attrs.role === r);
const open = (c: FakeNode) => role(c, "tab").find((t) => t.attrs["aria-selected"] === "true")!;

test("the provider tabs move with the arrow keys and the open tab labels the panel", async () => {
  const { doc } = installDom();
  const m = await mount(createElement(RoutingPage, { agents: [], settings: {}, onSettings: () => {}, initial: providers }), doc);
  unmount = m.unmount;
  const tabs = role(m.container, "tab");
  expect(tabs.map((t) => t.attrs.tabindex)).toEqual(["0", "-1", "-1"]);
  expect(tabs.every((t) => t.attrs["aria-controls"] === "routing-panel")).toBe(true);
  const panel = role(m.container, "tabpanel");
  expect(panel.map((x) => x.attrs.id)).toEqual(["routing-panel"]);
  expect(panel[0].attrs["aria-labelledby"]).toBe(open(m.container).attrs.id);

  const list = role(m.container, "tablist")[0];
  await fire(m.container, "keydown", list, { key: "ArrowRight" });
  expect(open(m.container).textContent).toContain("Codex");
  await fire(m.container, "keydown", list, { key: "End" });
  expect(open(m.container).textContent).toContain("Gemini");
  await fire(m.container, "keydown", list, { key: "ArrowRight" }); // wraps to the first
  expect(open(m.container).textContent).toContain("Claude Code");
  await fire(m.container, "keydown", list, { key: "ArrowLeft" });
  expect(open(m.container).textContent).toContain("Gemini");
  expect(role(m.container, "tabpanel")[0].attrs["aria-labelledby"]).toBe("routing-tab-gemini");
});
