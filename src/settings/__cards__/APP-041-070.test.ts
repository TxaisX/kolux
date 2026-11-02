// APP-041 box 1 (the copy half) and APP-070 box 3 on the real Settings > General cards and the real feedback box.
// The Tauri boundary is a recorder. The masking itself is Rust (diag.rs; cargo test --lib diag:: in the evidence);
// whether the real browser opens is LIVE.
import { createElement, Fragment } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, typeInto, until, withText } from "../../tasks/fakeDom";
import { OUTBOUND } from "../outbound";
import { FEEDBACK_REPO } from "../privacy";

const calls = vi.hoisted(() => ({ list: [] as { cmd: string; args: Record<string, unknown> }[], bundle: "" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    calls.list.push({ cmd, args });
    if (cmd === "diag_bundle") return Promise.resolve(calls.bundle);
    if (cmd === "app_info") return Promise.resolve({ version: "0.1.0" });
    if (cmd === "feedback_facts") return Promise.resolve({ release: "Windows 11", arch: "x86_64", login: null });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
let root: FakeNode;
const fetchSpy = vi.fn();
beforeEach(() => {
  doc = installDom().doc as FakeDocument;
  const bus = new Map<string, Set<(e: Event) => void>>();
  Object.assign((globalThis as unknown as { window: object }).window, {
    setTimeout,
    clearTimeout,
    addEventListener: (t: string, f: (e: Event) => void) => void (bus.get(t) ?? bus.set(t, new Set()).get(t)!).add(f),
    removeEventListener: (t: string, f: (e: Event) => void) => void bus.get(t)?.delete(f),
    dispatchEvent: (e: Event) => (bus.get(e.type)?.forEach((f) => f(e)), true),
  });
  Object.defineProperty(globalThis, "navigator", { value: { platform: "Win32", userAgent: "node", clipboard: { writeText: vi.fn(() => Promise.resolve()) } }, configurable: true });
  const proto = (doc.createElement("div") as FakeNode).constructor.prototype as Record<string, unknown>;
  proto.setSelectionRange = () => {};
  proto.getAnimations = () => [];
  calls.list = [];
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
  vi.unstubAllGlobals();
});
const button = (root: FakeNode, text: string) => find(root, (n) => n.localName === "button" && n.textContent.trim() === text)[0];

test("APP-041 box 1 (copy half): Copy diagnostics puts exactly the back end's scrubbed bundle on the clipboard", async () => {
  calls.bundle = "Kolux RS 0.1.0 diagnostics\nclaude --api-key [masked] -p \"hi\"\n";
  const { DiagnosticsCard } = await import("../GeneralPage");
  const m = await mount(createElement(DiagnosticsCard), doc);
  unmount = m.unmount;
  root = m.container;
  await click(root, button(doc.body, "Copy diagnostics"));
  await until(() => calls.list.some((c) => c.cmd === "clip_copy_text"), "the copy");
  const copies = calls.list.filter((c) => c.cmd === "clip_copy_text");
  expect(copies).toHaveLength(1);
  expect(copies[0].args.text).toBe(calls.bundle);
  expect(String(copies[0].args.text)).not.toMatch(/sk-ant|SECRET/);
  expect(calls.list.map((c) => c.cmd).sort()).toEqual(["clip_copy_text", "diag_bundle"]);
});

test("APP-070 box 3: Send feedback opens a pre-filled GitHub issue address in the browser and the app requests nothing itself", async () => {
  const { PrivacyCard } = await import("../GeneralPage");
  const { default: FeedbackDialog } = await import("../../feedback/FeedbackDialog");
  const m = await mount(createElement(Fragment, null, createElement(PrivacyCard), createElement(FeedbackDialog)), doc);
  unmount = m.unmount;
  root = m.container;
  expect(OUTBOUND.length).toBeGreaterThan(0); // the statement lists the connections
  await click(root, button(doc.body, "Send feedback"));
  await until(() => find(doc.body, (n) => n.attrs["aria-label"] === "Your feedback").length === 1, "the feedback box");
  await typeInto(root, find(doc.body, (n) => n.attrs["aria-label"] === "Your feedback")[0], "The pane froze after a resize");
  await click(root, withText(doc.body, "button", "Open on GitHub")[0]);
  await until(() => calls.list.some((c) => c.cmd === "open_external"), "the browser hand-off");
  const open = calls.list.filter((c) => c.cmd === "open_external");
  expect(open).toHaveLength(1);
  const u = new URL(String(open[0].args.url));
  expect(u.origin + u.pathname).toBe(FEEDBACK_REPO);
  expect(u.searchParams.get("title")).toBe("[Feedback] The pane froze after a resize");
  expect(u.searchParams.get("body")).toContain("The pane froze after a resize");
  expect(u.searchParams.get("body")).toContain("Kolux RS 0.1.0");
  // the only things the page asked the app to do: read its version and system, then open the address
  expect([...new Set(calls.list.map((c) => c.cmd))].sort()).toEqual(["app_info", "feedback_facts", "open_external"]);
  expect(fetchSpy).not.toHaveBeenCalled();
});
