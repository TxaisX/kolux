// T-675 (DT-C111; APP-037, APP-038): the Send Feedback box on the small DOM, with the back end stood in. Each test
// fails when its line in FeedbackDialog.tsx is reverted: one page per send however often Open on GitHub is pressed,
// the keyboard goes back to what opened the box, Add screenshot is a real button, and a send that was still running
// when the box was closed and opened again cannot close the new box or wipe its draft.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { byLabel, byText, click, type FakeDocument, FakeNode, find, fire, installDom, mount, typeInto, until } from "../tasks/fakeDom";

const back = vi.hoisted(() => ({ opened: [] as string[], hold: false, pending: [] as (() => void)[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { url?: string } = {}) => {
    if (cmd === "app_info") return Promise.resolve({ version: "0.1.5" });
    if (cmd === "feedback_facts") return Promise.resolve({ release: "10.0.26300", arch: "x86_64", login: null });
    if (cmd === "open_external") {
      back.opened.push(args.url ?? "");
      if (!back.hold) return Promise.resolve(null);
      return new Promise((ok) => back.pending.push(() => ok(null)));
    }
    return Promise.resolve(null);
  },
}));

let doc: FakeDocument;
let root: FakeNode;
let opener: FakeNode;
let unmount: () => Promise<void> = async () => {};
const proto = FakeNode.prototype as unknown as Record<string, unknown>;
const realFocus = FakeNode.prototype.focus;
const filePicks: FakeNode[] = [];

beforeEach(async () => {
  const dom = installDom();
  doc = dom.doc;
  const bus = new Map<string, Set<(e: Event) => void>>();
  Object.assign(dom.win, {
    setTimeout: (...a: Parameters<typeof setTimeout>) => globalThis.setTimeout(...a),
    clearTimeout: (h: number) => globalThis.clearTimeout(h),
    addEventListener: (t: string, f: (e: Event) => void) => void (bus.get(t) ?? bus.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: (e: Event) => void) => void bus.get(t)?.delete(f),
    dispatchEvent: (e: Event) => (bus.get(e.type)?.forEach((f) => f(e)), true),
  });
  Object.defineProperty(globalThis, "navigator", { value: { platform: "Win32", userAgent: "node" }, configurable: true });
  FakeNode.prototype.focus = function (this: FakeNode) {
    doc.activeElement = this;
  };
  Object.defineProperty(FakeNode.prototype, "isConnected", {
    configurable: true,
    get(this: FakeNode) {
      return doc.documentElement.contains(this);
    },
  });
  proto.setSelectionRange = () => {};
  proto.click = function (this: FakeNode) {
    filePicks.push(this);
  };
  Object.assign(back, { opened: [], hold: false, pending: [] });
  filePicks.length = 0;
  opener = doc.createElement("button"); // the menu item that opened the box
  doc.body.appendChild(opener);
  opener.focus();
  const { default: FeedbackDialog } = await import("./FeedbackDialog");
  const m = await mount(createElement(FeedbackDialog), doc);
  unmount = m.unmount;
  root = m.container;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  FakeNode.prototype.focus = realFocus;
  delete (FakeNode.prototype as unknown as Record<string, unknown>).isConnected;
  delete proto.setSelectionRange;
  delete proto.click;
});

const dialog = () => find(root, (n) => n.attrs.role === "dialog")[0] ?? null;
const textarea = () => find(root, (n) => n.localName === "textarea")[0];
const sendButton = () => find(root, (n) => n.localName === "button" && n.attrs.class === "btn primary")[0];
async function open(text: string) {
  const { requestFeedback } = await import("./FeedbackDialog");
  await act(async () => requestFeedback(text));
  await until(() => dialog() !== null, "the feedback box to open");
}
const escape = () => fire(root, "keydown", textarea(), { key: "Escape" });

test("T-675 feedback: a double press of Open on GitHub opens one page; the button says Opening… and keeps the keyboard", async () => {
  back.hold = true;
  await open("The tab bar flickers");
  await click(root, sendButton());
  expect(sendButton().textContent).toBe("Opening…");
  expect(sendButton().attrs["aria-disabled"]).toBe("true");
  expect(sendButton().hasAttribute("disabled")).toBe(false);
  await click(root, sendButton());
  await click(root, sendButton());
  expect(back.opened).toHaveLength(1);
  await act(async () => back.pending.shift()?.());
  await until(() => dialog() === null, "the box to close after the send");
  expect(back.opened).toHaveLength(1);
});

test("T-675 feedback: closing the box hands the keyboard back to what opened it", async () => {
  await open("Focus check");
  expect(doc.activeElement).toBe(textarea()); // the cursor starts in the box
  await escape();
  expect(dialog()).toBeNull();
  expect(doc.activeElement).toBe(opener);
});

test("T-675 feedback: Add screenshot is a real button that opens the file picker; a picked image is attached and its remove button names it", async () => {
  await open("Screenshot check");
  const add = byText(root, "button", "Add screenshot")[0];
  expect(add).toBeDefined();
  expect(add.attrs.type).toBe("button");
  await click(root, add);
  expect(filePicks).toHaveLength(1);
  expect(filePicks[0].localName).toBe("input");
  expect(filePicks[0].type ?? filePicks[0].attrs.type).toBe("file");
  // the user picks one PNG: it is attached, and its remove button names the file
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const input = filePicks[0];
  input.files = Object.assign([new File([png], "tab-bar.png", { type: "image/png" })], { item: () => null });
  await fire(root, "change", input);
  await until(() => byLabel(root, "button", "Remove tab-bar.png").length === 1, "the screenshot to attach");
  expect(byLabel(root, "button", "Remove tab-bar.png")[0].attrs.title).toBe("Remove tab-bar.png");
});

test("T-675 feedback: a send still running when the box is closed and opened again cannot close the new box or wipe its draft", async () => {
  back.hold = true;
  await open("First report");
  await click(root, sendButton());
  expect(back.opened).toHaveLength(1);
  await escape(); // closed while the browser was still opening
  await open("");
  await typeInto(root, textarea(), "Second report, still being written");
  await act(async () => back.pending.shift()?.()); // the first send finishes now
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  expect(dialog()).not.toBeNull();
  expect(textarea().value).toContain("Second report, still being written");
  expect(sendButton().textContent).toBe("Open on GitHub");
});
