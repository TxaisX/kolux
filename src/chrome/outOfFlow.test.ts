// DT-C269: a menu, a picker or the palette goes into the page inside an empty box that stands outside the layout
// (OutOfFlow.tsx). Put straight into a pane or into the window's body, a menu made WebKit lay that whole row out
// again and redraw what it holds, terminals included, once when it came and once when it went.
import { createElement } from "react";
import { expect, test, vi } from "vitest";
import { FakeNode, find, installDom, mount, settle } from "../tasks/fakeDom";

vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));

// Vitest returns "" for a .css import, so the stylesheet is read from disk (the project carries no Node types).
const nodeFs = (globalThis as unknown as { process: { getBuiltinModule(name: string): { readFileSync(p: URL, enc: string): string } } }).process.getBuiltinModule("node:fs");
const css = nodeFs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("DT-C269: the box is out of the flow and has no size, and makes no frame, layer or stacking context for what it holds", () => {
  const rule = css.match(/\n\.out-of-flow \{([^}]*)\}/);
  expect(rule, "the rule is in the window's own stylesheet, so both finishes have it").not.toBeNull();
  expect(rule![1].trim()).toBe("position: absolute; width: 0; height: 0;");
  // any of these would make it the frame a fixed menu is placed in, clip it, or end its z-index at the box
  const all = [...css.matchAll(/([^{}]*\.out-of-flow[^{}]*)\{([^}]*)\}/g)];
  expect(all.length, "one rule, and nothing else styles the box").toBe(1);
  expect(all[0][2]).not.toMatch(/z-index|transform|filter|contain|will-change|opacity|isolation|perspective|overflow|clip/);
});

test("DT-C269: every click-outside sheet goes into the page first inside the box, so its menu shares the box", () => {
  const files = import.meta.glob("../**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  let seen = 0;
  for (const [file, text] of Object.entries(files)) {
    if (/\.test\.tsx$/.test(file)) continue;
    for (const m of text.matchAll(/<div\b(?=[^<>]*?menu-backdrop)/g)) {
      seen++;
      // a JSX comment may sit between the box and the sheet (AccountSwitcher's says why the sheet is no drag region)
      const before = text.slice(0, m.index).trimEnd().replace(/\{\/\*[^*]*\*\/\}$/, "").trimEnd();
      expect(before.endsWith("<OutOfFlow>"), `${file}: a click-outside sheet put in the page outside an OutOfFlow box`).toBe(true);
    }
  }
  expect(seen).toBeGreaterThanOrEqual(24); // audit F16: the removed Source Control panel held one
});

test("DT-C269: the pane menu and its click-outside sheet are drawn inside the box, not straight into the pane", async () => {
  const { doc, win } = installDom();
  Object.assign(win, { addEventListener() {}, removeEventListener() {}, innerWidth: 1200, innerHeight: 800 });
  const proto = FakeNode.prototype as unknown as Record<string, unknown>;
  proto.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 120, width: 200, height: 120 });
  proto.querySelectorAll = () => [];
  proto.querySelector = () => null;
  const { default: PaneMenu, paneMenuItems } = await import("../terminal/PaneMenu");
  const items = paneMenuItems({ selected: false, expanded: false, canExpand: false, onCopy() {}, onSelectAll() {}, onPaste() {}, agentActions: [], copyIds: [], hasTitle: false, onClear() {}, onFind() {} });
  const { container } = await mount(createElement(PaneMenu, { style: {}, items, onDismiss() {} }), doc);
  await settle();
  const [box] = find(container, (n) => n.attrs.class === "out-of-flow");
  expect(box, "the menu's box").toBeTruthy();
  expect(box.parentNode, "the box is what goes into the pane").toBe(container);
  const kids = box.childNodes.filter((n) => n.nodeType === 1);
  expect(kids.map((n) => n.attrs.class)).toEqual(["menu-backdrop", "menu pane-menu"]);
  expect(kids[1].attrs.role).toBe("menu");
});
