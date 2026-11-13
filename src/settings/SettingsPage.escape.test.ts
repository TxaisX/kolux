// @vitest-environment happy-dom
// T-565 (VIEW-009): Escape closes Settings wherever the keyboard was when Settings opened, and an
// Escape a dialog inside Settings uses closes only that dialog. Settings is drawn over the panes,
// which stay mounted: the terminal under it is stood in for by a field that, like xterm
// (CoreBrowserTerminal.cancel), sends a key it handles to the program and stops it there.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byText, click, type FakeDocument, type FakeNode, find, fire, installDom, mount, settle, until, withText } from "../tasks/realDom";
import type { SettingsTarget } from "./pages";
import { FOCUSABLE } from "../chrome/dialogFocus";

const h = vi.hoisted(() => ({ agents: [] as { id: string; installed: boolean }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "project_list") return Promise.resolve([]);
    if (cmd === "get_settings") return Promise.resolve({});
    if (cmd === "agent_list") return Promise.resolve(h.agents);
    if (cmd === "grok_status") return Promise.resolve({ connection: "none", keySaved: false, signingIn: null, inBrowser: false, deviceLink: null, deviceCode: null, attention: null });
    return Promise.reject("not stubbed");
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
const cleanups: (() => void)[] = [];
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(doc, { visibilityState: "visible", hidden: false });
  h.agents = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  for (const c of cleanups.splice(0)) c();
});

/** A key pressed where the keyboard is: a real keydown at the focused element, the window's capture listeners first. */
const press = (key: string, shiftKey = false) => fire(doc.body, "keydown", document.activeElement ?? document.body, { key, shiftKey });
/** The browser takes the keyboard off a control that is no longer drawn. */
const dropFocus = () => (document.activeElement as HTMLElement | null)?.blur?.();

/** The focused terminal under Settings: what reaches it is what the program would get. */
function terminal() {
  const node = doc.createElement("textarea");
  doc.body.appendChild(node);
  const sent: string[] = [];
  node.addEventListener(
    "keydown",
    (e: unknown) => {
      const k = e as { key: string; preventDefault(): void; stopPropagation(): void };
      sent.push(k.key);
      k.preventDefault();
      k.stopPropagation();
    },
    true,
  );
  node.focus();
  return { node, sent };
}

async function open(onClose: () => void, target: SettingsTarget | null = null) {
  const { default: SettingsPage } = await import("./SettingsPage");
  const m = await mount(createElement(SettingsPage, { onClose, target, n: target ? 1 : 0 }), doc);
  unmount = m.unmount;
  await until(() => find(m.container, (n) => /settings-link/.test(n.attrs.class ?? "")).length >= 10, "the side list");
  await settle();
  return m;
}

test("Settings opened from a terminal takes the keyboard: Escape closes it and never reaches the terminal", async () => {
  const term = terminal();
  const closed = vi.fn();
  await open(closed);
  await press("Escape");
  expect(term.sent).toEqual([]);
  expect(closed).toHaveBeenCalledTimes(1);
});

test("Escape with the keyboard on a control inside Settings closes Settings", async () => {
  terminal();
  const closed = vi.fn();
  const m = await open(closed);
  byText(m.container, "button", "Appearance")[0].focus();
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});

test("closing Settings gives the keyboard back to the terminal it was opened from", async () => {
  const term = terminal();
  await open(() => {});
  expect(doc.activeElement).not.toBe(term.node);
  await unmount();
  unmount = async () => {};
  expect(doc.activeElement).toBe(term.node);
});

test("Escape in the xAI key dialog inside Settings closes only that dialog; the next one closes Settings", async () => {
  h.agents = [{ id: "grok", installed: true }];
  terminal();
  const closed = vi.fn();
  const m = await open(closed, { page: "accounts" });
  const way = () => withText(m.container, "button", "Use an xAI API key")[0];
  await until(() => !!way(), "the Grok card");
  await click(m.container, way());
  const shown = () => find(m.container, (n) => n.attrs["aria-label"] === "Use an xAI API key" && n.attrs.role === "dialog").length === 1;
  await until(shown, "the key dialog");
  await until(() => document.activeElement?.getAttribute("aria-label") === "xAI API key", "focus on the key field");
  await press("Escape");
  await settle();
  expect(shown()).toBe(false);
  expect(closed).not.toHaveBeenCalled();
  // The next Escape leaves Settings.
  dropFocus();
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});

/** A dialog that, like the Usage Share card (ShareCard.tsx) and the Send feedback box (FeedbackDialog.tsx),
 *  closes on Escape from a listener of its own and lets the Escape go on. It goes away at once, as the
 *  browser's microtask checkpoint between listeners lets React take it off the page. */
function looseDialog(parent: FakeNode, on: "window" | "self") {
  const node = doc.createElement("div");
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-modal", "true");
  const field = doc.createElement("input");
  node.appendChild(field);
  parent.appendChild(node);
  const close = (e: unknown) => (e as { key: string }).key === "Escape" && node.remove();
  if (on === "window") {
    window.addEventListener("keydown", close);
    cleanups.push(() => window.removeEventListener("keydown", close));
  } else node.addEventListener("keydown", close);
  return { node, field, shown: () => !!node.parentNode };
}

test("Escape in a dialog inside Settings that does not stop it (the Share card) closes only that dialog", async () => {
  terminal();
  const closed = vi.fn();
  const m = await open(closed);
  const settings = find(m.container, (n) => n.attrs["aria-label"] === "Settings")[0];
  const share = looseDialog(settings, "window");
  await press("Escape"); // the keyboard is on the Settings root, as after a click on Share
  expect(share.shown()).toBe(false);
  expect(closed).not.toHaveBeenCalled();
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});

test("Escape in a dialog outside Settings with the keyboard in it (Send feedback) closes only that dialog", async () => {
  terminal();
  const closed = vi.fn();
  await open(closed);
  const box = looseDialog(doc.body, "self");
  box.field.focus();
  await press("Escape");
  expect(box.shown()).toBe(false);
  expect(closed).not.toHaveBeenCalled();
  dropFocus();
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});

test("T-732: Settings is a modal dialog that keeps Tab inside: Shift+Tab from its first control wraps to its last, Tab from the last to the first", async () => {
  terminal();
  const m = await open(vi.fn());
  const root = find(m.container, (n) => n.attrs.role === "dialog" && n.attrs["aria-label"] === "Settings")[0];
  expect(root.attrs["aria-modal"]).toBe("true");
  const all = [...root.querySelectorAll(FOCUSABLE)] as FakeNode[];
  expect(all.length).toBeGreaterThan(10);
  all[0].focus();
  await press("Tab", true);
  expect(doc.activeElement, "Shift+Tab from the first control stays in Settings, on its last").toBe(all[all.length - 1]);
  await press("Tab");
  expect(doc.activeElement, "Tab from the last control wraps to the first").toBe(all[0]);
});

test("a dialog of a pane under Settings (the shell ended) does not block Escape", async () => {
  terminal();
  const closed = vi.fn();
  await open(closed);
  const ended = doc.createElement("div");
  ended.setAttribute("role", "alertdialog");
  ended.setAttribute("aria-modal", "true");
  doc.body.appendChild(ended);
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});
