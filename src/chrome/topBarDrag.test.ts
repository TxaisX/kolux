// T-620 (Txais 2026-10-30): the whole top bar moves the window, not one spot. These tests apply the rules of
// Tauri's drag script (tauri 2.12, window/scripts/drag.js, isDragRegion) to every element the bar draws: a
// press on anything a person can use (a control, a menu, an element with a press or click handler, the
// switcher's frame) must never move the window, and a press anywhere else on the bar must. The handlers are
// read from React's props on each node, so a clickable span or a new pop-up added to the bar later fails
// here without this file changing.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, FakeNode, click, find, installDom, mount, settle } from "../tasks/fakeDom";
import { publishClaude } from "../usage/plan";

vi.mock("@tauri-apps/api/core", () => ({
  // One managed Claude account, so the account switcher draws its pill (and its menu) inside the bar.
  invoke: (cmd: string) =>
    Promise.resolve(cmd === "claude_accounts" ? { accounts: [{ id: "a1", email: "work@example.com", organization: null, stale: false }], active: "a1", signingIn: null, keyMode: false, upkeepLeftToClaude: false } : null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ isMaximized: () => Promise.resolve(false), onResized: () => Promise.resolve(() => {}) }) }));
// The usage pill as the bar draws it (its own button around a figure), without the pills' background reads.
vi.mock("../usage/UsagePill", async (importOriginal) => {
  const real = await importOriginal<typeof import("../usage/UsagePill")>();
  const { createElement: h } = await import("react");
  return { ...real, default: ({ hidden }: { hidden: boolean }) => h(real.UsagePillView, { hidden, onOpen: () => {} }, h("span", null, "Claude 60% left")) };
});

const DRAG = "data-tauri-drag-region";
const XHTML = "http://www.w3.org/1999/xhtml";
// drag.js: these block a drag unless they carry the attribute themselves.
const TAGS = new Set(["a", "button", "input", "select", "textarea", "label", "summary"]);
const ROLES = new Set(["button", "link", "menuitem", "tab", "checkbox", "radio", "switch", "option"]);
const clickable = (n: FakeNode) =>
  TAGS.has(n.localName) || (n.attrs.contenteditable !== undefined && n.attrs.contenteditable !== "false") || (n.attrs.tabindex !== undefined && n.attrs.tabindex !== "-1") || ROLES.has(n.attrs.role ?? "");

/** drag.js isDragRegion for a press on `target`: walk up past anything that is not an HTML element (an
 *  icon's SVG), and the first rule that applies decides. */
function drags(target: FakeNode): boolean {
  for (let el: FakeNode | null = target; el; el = el.parentNode) {
    if (el.nodeType !== 1 || el.namespaceURI !== XHTML) continue;
    const attr = el.attrs?.[DRAG];
    if (clickable(el) && attr === undefined) return false;
    if (attr === undefined) continue;
    if (attr === "false") return false;
    if (attr === "deep") return true;
    if (attr === "" || attr === "true") return el === target;
  }
  return false;
}

const HANDLERS = ["onClick", "onMouseDown", "onMouseUp", "onPointerDown", "onPointerUp", "onDoubleClick", "onContextMenu"];
const reactProps = (n: FakeNode): Record<string, unknown> => {
  const key = Object.keys(n).find((k) => k.startsWith("__reactProps$"));
  return key ? n[key] : {};
};
const handled = (n: FakeNode) => HANDLERS.some((h) => typeof reactProps(n)[h] === "function");
/** Something a person uses: a control, a menu, an element with a handler, or a group of controls (the switcher's frame). */
const usable = (n: FakeNode) => clickable(n) || handled(n) || n.attrs.role === "menu" || n.localName === "nav";
const inUsable = (n: FakeNode, top: FakeNode) => {
  for (let el: FakeNode | null = n; el && el !== top.parentNode; el = el.parentNode) if (usable(el)) return true;
  return false;
};
const name = (n: FakeNode) => `<${n.localName}${n.attrs.class ? ` .${n.attrs.class}` : ""}${n.attrs.title ? ` "${n.attrs.title}"` : ""}${n.attrs.role ? ` role=${n.attrs.role}` : ""}>`;

/** Every element of the bar, sorted by what a press on it should do, and the ones that do the other thing. */
function audit(header: FakeNode) {
  const all = find(header, () => true);
  const used = all.filter((n) => inUsable(n, header));
  const bare = all.filter((n) => !inUsable(n, header));
  return { used, bare, usedThatDrag: used.filter(drags).map(name), bareThatDoNot: bare.filter((n) => !drags(n)).map(name) };
}

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  ({ doc } = installDom());
  // A weekly Claude figure and Claude installed (barProps), so the bar draws its usage pill.
  publishClaude([{ kind: "seven_day", usedPercent: 40, resetsAt: null }]);
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const noop = () => {};
const barProps = (classic: boolean) => ({ screen: "terminals", classic, sidebarWidth: 260, onScreen: noop, sidebarOpen: true, onToggleSidebar: noop, rightOpen: false, onToggleRight: noop, appName: true, automations: { open: false, onToggle: noop }, installed: ["claude"], onSearch: noop, onBack: noop, onForward: noop, appMenu: true, needsYou: 3 });

async function mountBar(classic: boolean) {
  const { default: TopBar } = await import("./TopBar");
  const m = await mount(createElement(TopBar, barProps(classic) as Parameters<typeof TopBar>[0]), doc);
  unmount = m.unmount;
  await settle();
  const c = m.container as FakeNode;
  return { c, header: find(c, (n) => n.localName === "header")[0] };
}

/** The fake DOM has no layout; the menu buttons place their menu from their own box. */
const pressMenuButton = async (c: FakeNode, title: string) => {
  const b = find(c, (n) => n.localName === "button" && n.attrs.title === title)[0];
  expect(b, `the "${title}" button is drawn`).toBeDefined();
  b.getBoundingClientRect = () => ({ left: 8, right: 300, top: 0, bottom: 36 });
  await click(c, b);
  await settle();
};

for (const classic of [false, true]) {
  test(`${classic ? "Classic: " : ""}a press anywhere on the bar that is not a control moves the window, and no control does`, async () => {
    const { header } = await mountBar(classic);
    expect(header.attrs[DRAG]).toBe("deep");
    expect(find(header, handled).length, "React's handlers are readable from the nodes").toBeGreaterThan(8);
    const pills = find(header, (n) => n.localName === "button" && (n.attrs.class === "usage" || n.attrs.class === "acct-switch") && n.attrs.hidden === undefined);
    expect(pills.length, "the usage pill and the account pill are drawn").toBe(2);
    const { used, bare, usedThatDrag, bareThatDoNot } = audit(header);
    expect(used.length).toBeGreaterThan(20);
    expect(bare.length).toBeGreaterThan(2);
    expect(usedThatDrag, "presses on these move the window, but a person uses them").toEqual([]);
    expect(bareThatDoNot, "presses on these should move the window").toEqual([]);
  });
}

test("the account menu drawn inside the bar never moves the window", async () => {
  const { c, header } = await mountBar(false);
  await pressMenuButton(c, "Choose the account new panes use");
  const backdrops = find(header, (n) => n.attrs.class === "menu-backdrop");
  const menus = find(header, (n) => n.attrs.role === "menu");
  expect(backdrops.length, "the menu is open with its backdrop").toBe(1);
  expect(menus.map((m) => m.attrs["aria-label"]).sort()).toEqual(["Accounts for new panes"]);
  for (const part of [...backdrops, ...menus]) expect(part.attrs[DRAG], name(part)).toBe("false");
  const { usedThatDrag, bareThatDoNot } = audit(header);
  expect(usedThatDrag, "presses on these move the window, but a person uses them").toEqual([]);
  expect(bareThatDoNot, "presses on these should move the window").toEqual([]);
});
