// T-565 (VIEW-009): Escape closes Settings wherever the keyboard was when Settings opened, and an
// Escape a dialog inside Settings uses closes only that dialog. Settings is drawn over the panes,
// which stay mounted: the terminal under it is stood in for by a field that, like xterm
// (CoreBrowserTerminal.cancel), sends a key it handles to the program and stops it there.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byText, click, type FakeDocument, FakeNode, find, installDom, mount, settle, until, withText } from "../tasks/fakeDom";
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

type Listener = { fn: (e: unknown) => void; capture: boolean };
let doc: FakeDocument;
let onWindow: Record<string, Listener[]>;
let unmount: () => Promise<void> = async () => {};
const realFocus = FakeNode.prototype.focus;
/** Just enough of Element.matches for attribute selectors such as '[role="dialog"],[hidden]'. */
function matches(n: FakeNode, sel: string) {
  // The Tab trap's list (T-732): enabled form controls, links, and anything with a tabindex other than -1.
  if (sel === FOCUSABLE)
    return n.nodeType === 1 && ((/^(button|input|select|textarea)$/.test(n.localName) && !("disabled" in n.attrs) && n.attrs.type !== "hidden") || (n.localName === "a" && "href" in n.attrs) || ("tabindex" in n.attrs && n.attrs.tabindex !== "-1"));
  return sel.split(",").some((one) => {
    const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(one.trim());
    return !!m && n.nodeType === 1 && m[1] in n.attrs && (m[2] === undefined || n.attrs[m[1]] === m[2]);
  });
}
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  onWindow = {};
  Object.assign(globalThis, { localStorage: dom.win.localStorage, requestAnimationFrame: () => 0, cancelAnimationFrame() {} });
  Object.assign(dom.win, {
    addEventListener: (t: string, fn: Listener["fn"], o?: boolean | { capture?: boolean }) => (onWindow[t] ??= []).push({ fn, capture: typeof o === "object" ? !!o.capture : !!o }),
    removeEventListener: (t: string, fn: Listener["fn"]) => (onWindow[t] = (onWindow[t] ?? []).filter((l) => l.fn !== fn)),
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    dispatchEvent: () => true,
  });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  // The keyboard goes where focus() puts it.
  FakeNode.prototype.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  FakeNode.prototype.closest = function (this: FakeNode, sel: string) {
    for (let n: FakeNode | null = this; n; n = n.parentNode) if (matches(n, sel)) return n;
    return null;
  };
  FakeNode.prototype.querySelectorAll = function (this: FakeNode, sel: string) {
    return find(this, (n) => n !== this && matches(n, sel));
  };
  h.agents = [];
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  FakeNode.prototype.focus = realFocus;
  delete FakeNode.prototype.closest;
  delete FakeNode.prototype.querySelectorAll;
});

/** A key pressed where the keyboard is, sent as a browser sends it: capture listeners from the window
 *  down to the target, then bubble listeners back up; a listener that stops it ends the trip there. */
async function press(key: string, shiftKey = false) {
  const target = doc.activeElement;
  const nodes: { listeners: Record<string, Listener[]> }[] = [{ listeners: onWindow }, doc];
  const up: FakeNode[] = [];
  for (let n: FakeNode | null = target; n; n = n.parentNode) up.unshift(n);
  nodes.push(...up);
  let stopped = false;
  let now = false;
  const ev = {
    type: "keydown",
    key,
    code: key,
    keyCode: key === "Escape" ? 27 : 0,
    which: key === "Escape" ? 27 : 0,
    target,
    srcElement: target,
    bubbles: true,
    cancelable: true,
    defaultPrevented: false,
    isTrusted: true,
    isComposing: false,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    shiftKey,
    metaKey: false,
    timeStamp: Date.now(),
    getModifierState: () => false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    stopImmediatePropagation() {
      stopped = now = true;
    },
  };
  const run = (n: { listeners: Record<string, Listener[]> }, capture: boolean) => {
    for (const l of [...(n.listeners.keydown ?? [])]) if (l.capture === capture && !now) l.fn(ev);
  };
  await act(async () => {
    const last = nodes.length - 1;
    for (let i = 0; i < last && !stopped; i++) run(nodes[i], true);
    if (!stopped) run(nodes[last], true); // at the target: its capture listeners, then its others
    if (!stopped) run(nodes[last], false);
    for (let i = last - 1; i >= 0 && !stopped; i--) run(nodes[i], false);
  });
}

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
  const form = find(m.container, (n) => n.attrs["aria-label"] === "Use an xAI API key")[0];
  const shown = () => !("hidden" in form.parentNode!.attrs);
  await until(shown, "the key dialog");
  expect(doc.activeElement.attrs["aria-label"]).toBe("xAI API key");
  await press("Escape");
  expect(shown()).toBe(false);
  expect(closed).not.toHaveBeenCalled();
  // The browser takes the keyboard off a field that is no longer drawn; the next Escape leaves Settings.
  doc.activeElement = doc.body;
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});

/** A dialog that, like the Usage Share card (ShareCard.tsx) and the Send feedback box (FeedbackDialog.tsx),
 *  closes on Escape from a listener of its own and lets the Escape go on. It goes away at once, as the
 *  browser's microtask checkpoint between listeners lets React take it off the page. */
function looseDialog(parent: FakeNode, on: "window" | "self") {
  const node = doc.createElement("div");
  Object.assign(node.attrs, { role: "dialog", "aria-modal": "true" });
  const field = doc.createElement("input");
  node.appendChild(field);
  parent.appendChild(node);
  const close = (e: unknown) => (e as { key: string }).key === "Escape" && node.remove();
  if (on === "window") onWindow.keydown.push({ fn: close, capture: false });
  else node.addEventListener("keydown", close);
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
  doc.activeElement = doc.body;
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});

test("T-732: Settings is a modal dialog that keeps Tab inside: Shift+Tab from its first control wraps to its last, Tab from the last to the first", async () => {
  terminal();
  const m = await open(vi.fn());
  const root = find(m.container, (n) => n.attrs.role === "dialog" && n.attrs["aria-label"] === "Settings")[0];
  expect(root.attrs["aria-modal"]).toBe("true");
  const all = root.querySelectorAll(FOCUSABLE) as unknown as FakeNode[];
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
  Object.assign(ended.attrs, { role: "alertdialog", "aria-modal": "true" });
  doc.body.appendChild(ended);
  await press("Escape");
  expect(closed).toHaveBeenCalledTimes(1);
});
