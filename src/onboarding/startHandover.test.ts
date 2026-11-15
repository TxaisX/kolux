// Job 22 item 1 (FROZEN decision 8, one Start question): the first-run screens hand over to the Start form. The last
// screen has one main button and no AI pick; pressing it closes the first-run screens and opens the Start form once,
// on the folder in front (the one picked on Your work). The close is stored as "completed", as before.
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

const bag: Record<string, unknown> = {};
vi.mock("../shell/window/store", () => ({ useWindow: () => bag }));
vi.mock("../lazy/pages", async (orig) => ({ ...(await orig<typeof import("../lazy/pages")>()), Wizard: Object.assign(() => null, { displayName: "Wizard" }) }));

import { NO_AGENT_WHY, START_MAIN, WizardView } from "./Wizard";
import { Wizard } from "../lazy/pages";
import WindowHosts from "../shell/window/Hosts";

const view = (more: Record<string, unknown> = {}) =>
  renderToString(createElement(WizardView, { at: 3, connected: true, ping: true, hooks: true, onHooks() {}, onPing() {}, onBack() {}, onMain() {}, onSecondary() {}, onPickFolder() {}, ...more }));

test("the last screen has one main button, the same with or without a folder, and no AI pick", () => {
  for (const hasFolder of [true, false]) {
    const html = view({ hasFolder });
    expect(html.match(/class="btn primary/g)).toHaveLength(1);
    expect(html).toMatch(new RegExp(`>${START_MAIN}<span`));
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("onb-choices");
    expect(html).not.toContain("Plain terminal");
  }
  expect(START_MAIN).not.toMatch(/session|seat|shape/i);
});

test("with no AI installed the button still opens the form, and the install help stays", () => {
  const html = view({ hasFolder: true, noAgent: true });
  expect(html).toContain(NO_AGENT_WHY.split(".")[0]);
  expect(html).toContain("Check again");
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>/);
});

type El = ReactElement<Record<string, (...a: unknown[]) => unknown>>;
const wizardOf = (tree: unknown): El | null => {
  if (!tree || typeof tree !== "object") return null;
  const el = tree as El & { props: { children?: unknown } };
  if (el.type === Wizard) return el;
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const hit = wizardOf(k);
    if (hit) return hit;
  }
  return null;
};

const host = (activeDir: string | null) => {
  const openStart = vi.fn();
  const wizardSession = vi.fn((open: () => void) => open());
  Object.assign(bag, {
    wizard: 3, settings: {}, saveSetting() {}, wizardSession, wizardClose: { retry: () => false }, pickFolder() {}, projects: [{ id: "p1", path: "C:/w" }], endWizard() {}, firstFolder: { current: false },
    screen: "grid", setScreen() {}, settingsRead: true, picked: null, notes: [], repoless: false, activeDir, putNote() {}, setNotes() {}, setPicked() {},
    reviewTargets: [], sendMenu: null, setSendMenu() {}, sendReview() {}, startReview() {}, agents: [], defaultId: "", live: [], panes: [], ptys: { current: {} }, titles: {},
    owner: {}, restoredKeys: new Set(), setToast() {}, openStart,
  });
  const el = wizardOf(WindowHosts());
  return { el, openStart, wizardSession };
};

test("pressing the main button hands over: the first-run screens close and the Start form opens once, on the folder in front", () => {
  const { el, openStart, wizardSession } = host("C:/w");
  expect(el).not.toBeNull();
  el!.props.onSession();
  expect(wizardSession).toHaveBeenCalledTimes(1);
  expect(openStart).toHaveBeenCalledTimes(1);
  expect(openStart).toHaveBeenCalledWith({ here: true });
});

test("with no folder in front the form opens on its own pick (the last Start's folders, else the first project)", () => {
  const { el, openStart } = host(null);
  el!.props.onSession();
  expect(openStart).toHaveBeenCalledTimes(1);
  expect(openStart).toHaveBeenCalledWith({ here: false });
});
