// SKILL-036 acceptance: the real ArtifactsPage on the small DOM. evidence/cards-SKILL-036-replay.json is written by
// src-tauri/tests/cards_15.rs: `script` is the link hand-off the app's kolux-artifact scheme really appends to a served page,
// `addError` is the text Library::add really returns for a file it cannot read. Rust halves: cards_15.rs skill036_box2/box3.
// MIRROR: the stand-in invoke below only records open_external and answers artifacts_list/artifact_add; the page code is the product's.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import replay from "../../../evidence/cards-SKILL-036-replay.json";
import { byText, click, type FakeDocument, type FakeNode, find, installDom, mount, settle, typeInto, until, withText } from "../../tasks/fakeDom";

const h = vi.hoisted(() => ({
  lib: [] as { id: string; title: string; added: number }[],
  picks: [] as string[],
  calls: [] as { cmd: string; args: Record<string, unknown> }[],
  addError: "",
  openError: "",
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    if (cmd === "artifacts_list") return Promise.resolve([...h.lib].sort((a, b) => b.added - a.added).map((e) => ({ ...e, source: "hand", origin: e.id, project: null, session: null, size: 2048, page: `${e.id}.html`, state: "ok", stored: true })));
    if (cmd === "artifact_add") return Promise.reject(h.addError);
    if (cmd === "open_external") return h.openError ? Promise.reject(h.openError) : Promise.resolve(null);
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(h.picks.shift() ?? null) }));

let doc: FakeDocument;
let messageHandlers: ((e: unknown) => void)[] = [];
/** The other listeners the page puts on its window (pointerdown, keydown, blur and so on), by type. */
let winHandlers: Record<string, ((e: unknown) => void)[]> = {};
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  messageHandlers = [];
  winHandlers = {};
  Object.assign(dom.win, {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    addEventListener: (t: string, fn: (e: unknown) => void) => void (t === "message" ? messageHandlers.push(fn) : (winHandlers[t] ??= []).push(fn)),
    removeEventListener: (t: string, fn: (e: unknown) => void) => {
      if (t === "message") messageHandlers = messageHandlers.filter((f) => f !== fn);
      else winHandlers[t] = (winHandlers[t] ?? []).filter((f) => f !== fn);
    },
  });
  h.lib = [];
  h.picks = [];
  h.calls = [];
  h.addError = "";
  h.openError = "";
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

const toasts: string[] = [];
async function page() {
  toasts.length = 0;
  const { default: ArtifactsPage } = await import("../ArtifactsPage");
  const m = await mount(createElement(ArtifactsPage, { onToast: (t: string) => void toasts.push(t) }), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await settle();
  return c;
}
const rows = (c: FakeNode) => find(c, (n) => n.attrs.role === "option");
const titles = (c: FakeNode) => rows(c).map((r) => find(r, (n) => String(n.attrs.className ?? n.attrs.class ?? "") === "name")[0]?.textContent);

test("box 1: a search with two words keeps only the titles holding both", async () => {
  h.lib = [
    { id: "a", title: "Quarterly Sales Report", added: 4 },
    { id: "b", title: "Sales Chart", added: 3 },
    { id: "c", title: "Weekly Report", added: 2 },
    { id: "d", title: "REPORT on SALES by region", added: 1 },
  ];
  const c = await page();
  expect(titles(c)).toEqual(["Quarterly Sales Report", "Sales Chart", "Weekly Report", "REPORT on SALES by region"]);
  const input = find(c, (n) => n.localName === "input")[0];
  await typeInto(c, input, "sales report");
  expect(titles(c)).toEqual(["Quarterly Sales Report", "REPORT on SALES by region"]);
  await typeInto(c, input, "report SALES");
  expect(titles(c)).toEqual(["Quarterly Sales Report", "REPORT on SALES by region"]);
  await typeInto(c, input, "sales chart");
  expect(titles(c)).toEqual(["Sales Chart"]);
});

/** Runs the hand-off script the Rust side appends to a served page, with the browser objects it uses faked. */
function viewedPage() {
  const listeners: ((e: unknown) => void)[] = [];
  const posted: { msg: unknown; target: string }[] = [];
  const document = { addEventListener: (t: string, fn: (e: unknown) => void) => void (t === "click" && listeners.push(fn)) };
  const location = { href: `http://kolux-artifact.localhost/${replay.id}/viewed.html`, protocol: "http:", host: "kolux-artifact.localhost" };
  new Function("document", "location", "parent", replay.script)(document, location, { postMessage: (msg: unknown, target: string) => posted.push({ msg, target }) });
  expect(listeners).toHaveLength(1);
  return {
    posted,
    click(href: string | null) {
      let prevented = false;
      const a = href === null ? null : { getAttribute: () => href };
      listeners[0]({ target: { closest: () => a }, preventDefault: () => void (prevented = true) });
      return prevented;
    },
  };
}

test("box 2: a clicked link leaves the viewer as a message, and the page hands it to the system opener, not to Kolux", async () => {
  // Inside the viewer (the product's own appended script).
  const v = viewedPage();
  expect(v.click("https://example.invalid/x?q=1")).toBe(true);
  expect(v.click("mailto:someone@example.invalid")).toBe(true);
  expect(v.posted).toEqual([
    { msg: { koluxOpen: "https://example.invalid/x?q=1" }, target: "*" },
    { msg: { koluxOpen: "mailto:someone@example.invalid" }, target: "*" },
  ]);
  // A link to another stored file of the same entry stays inside; one to a different entry goes nowhere.
  expect(v.click("other.html")).toBe(false);
  expect(v.click("/0000000000000000/x.html")).toBe(true);
  expect(v.click(null)).toBe(false);
  expect(v.posted).toHaveLength(2);

  // In the library page: the message from its own frame becomes open_external; Kolux itself navigates nowhere.
  h.lib = [{ id: replay.id, title: "Viewed", added: 1 }];
  const c = await page();
  await click(c, rows(c)[0]);
  await until(() => find(c, (n) => n.localName === "iframe").length === 1);
  const frame = find(c, (n) => n.localName === "iframe")[0] as FakeNode & { contentWindow?: unknown };
  const own = {};
  frame.contentWindow = own;
  expect(messageHandlers).toHaveLength(1);
  const opened = () => h.calls.filter((x) => x.cmd === "open_external").map((x) => x.args);
  const deliver = async (source: unknown, data: unknown) => {
    messageHandlers[0]({ source, data });
    await settle();
  };
  const ask = () => find(c, (n) => n.attrs["aria-label"] === "Open link");
  await deliver({}, { koluxOpen: "https://elsewhere.invalid/" }); // not our frame
  await deliver(own, { somethingElse: 1 });
  expect(ask()).toHaveLength(0);
  // DT-C77: the page's own script posts on load, in a loop, with or without any click: Kolux only asks.
  for (let i = 0; i < 12; i++) await deliver(own, { koluxOpen: `https://elsewhere.invalid/?d=${i}` });
  expect(opened()).toEqual([]);
  expect(ask()).toHaveLength(1);
  expect(withText(ask()[0], "strong", "elsewhere.invalid")).toHaveLength(1);
  // Cancel opens nothing and closes the question.
  await click(c, byText(ask()[0], "button", "Cancel")[0]);
  expect(ask()).toHaveLength(0);
  expect(opened()).toEqual([]);
  // The frame's own script posts what a click on its link posts; the user answers in Kolux with Open.
  for (const m of v.posted) await deliver(own, m.msg);
  expect(opened()).toEqual([]);
  expect(withText(ask()[0], "strong", "someone@example.invalid")).toHaveLength(1); // the newest request replaced the first
  await click(c, byText(ask()[0], "button", "Open")[0]);
  expect(opened()).toEqual([{ url: "mailto:someone@example.invalid" }]);
  expect(ask()).toHaveLength(0);
  expect(toasts).toEqual([]);
  // A refusal from the opener surfaces as a toast.
  h.openError = "boom: could not open";
  await deliver(own, { koluxOpen: "https://example.invalid/refused" });
  await click(c, byText(ask()[0], "button", "Open")[0]);
  await settle();
  expect(toasts).toEqual(["boom: could not open"]);
  // The frame is sandboxed without top navigation or popups.
  expect(String(frame.attrs.sandbox)).toBe("allow-scripts allow-forms");
});

test("box 3: Add artifact with a file that cannot be read shows an error toast and the list stays as it was", async () => {
  h.lib = [{ id: "keep", title: "Already here", added: 1 }];
  h.addError = replay.addError; // the real Library::add error text
  const c = await page();
  expect(titles(c)).toEqual(["Already here"]);
  h.picks = ["missing.html"];
  const add = find(c, (n) => n.localName === "button" && n.textContent.trim() === "Add artifact")[0];
  await click(c, add);
  await until(() => toasts.length === 1);
  expect(toasts[0]).toBe(`Could not add that page: ${replay.addError}`);
  expect(toasts[0]).toContain("could not read missing.html");
  await settle();
  expect(titles(c)).toEqual(["Already here"]);
  expect(find(c, (n) => n.localName === "iframe")).toEqual([]);
  expect(c.textContent).toContain("Pick an artifact to view it here.");
  // Cancelling the picker is not an error.
  await click(c, add);
  await settle();
  expect(toasts).toHaveLength(1);
});
