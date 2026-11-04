// C10-R2-01: the All Changes tab (the live commit box) commits on Ctrl+Enter from its own message
// field only. The same chord in any other text box of the window (a handoff note, a pull request
// description) is that field's own key and writes nothing.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type FakeDocument, type FakeNode, find, fire, installDom, mount, settle, typeInto, until } from "../tasks/fakeDom";
import { emptyStatus, type Status } from "../scm/model";

const h = vi.hoisted(() => ({ status: null as unknown as Status, calls: [] as [string, unknown][] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => {
    h.calls.push([cmd, args]);
    if (cmd === "scm_status") return Promise.resolve(h.status);
    if (cmd === "change_entries") return Promise.resolve([]);
    if (cmd === "scm_commit") return Promise.resolve({ id: "abc1234", blocked: false, output: "" });
    return Promise.resolve(null);
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("../scm/watch", () => ({ watchStatus: () => () => {} }));
vi.mock("../settings/useSettings", () => ({ useSettings: () => ({ settings: {}, error: null, save: () => Promise.resolve(true) }) }));

const ROOT = "C:/repo";
// The pane pulls CodeMirror in on its first mount, which is slow on a loaded machine.
vi.setConfig({ testTimeout: 20_000 });
const status: Status = { ...emptyStatus, branch: "feat", staged: [{ path: "a.ts", status: "M", from: null }] };

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  const frames = { requestAnimationFrame: (f: () => void) => setTimeout(f, 0) as unknown as number, cancelAnimationFrame: (n: number) => clearTimeout(n) };
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, ...frames });
  for (const [k, v] of Object.entries(frames)) vi.stubGlobal(k, v);
  h.calls.length = 0;
  h.status = status;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

/** The tab as the window draws it: a handoff note and a pull request description sit beside it. */
async function mounted() {
  const { default: AllChangesPane } = await import("./AllChangesPane");
  const Host = () =>
    createElement(
      "div",
      null,
      createElement("textarea", { "aria-label": "handoff note" }),
      createElement("textarea", { "aria-label": "pull request description" }),
      createElement(AllChangesPane, { id: 1, root: ROOT }),
    );
  const m = await mount(createElement(Host), doc);
  unmount = m.unmount;
  await settle(80);
  return m.container as FakeNode;
}

const commits = () => h.calls.filter(([cmd]) => cmd === "scm_commit").map(([, args]) => args);
const field = (c: FakeNode, label: string) => find(c, (n) => n.attrs["aria-label"] === label)[0];
const press = (c: FakeNode, target: FakeNode, extra: Record<string, unknown> = {}) => fire(c, "keydown", target, { key: "Enter", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, ...extra });

test("Ctrl+Enter in a handoff note or a pull request description commits nothing", async () => {
  const c = await mounted();
  await typeInto(c, field(c, "Commit message"), "Add the thing");
  await typeInto(c, field(c, "handoff note"), "Handing this to the next agent");
  await press(c, field(c, "handoff note"));
  await settle(40);
  await typeInto(c, field(c, "pull request description"), "What this branch does");
  await press(c, field(c, "pull request description"));
  await settle(40);
  expect(commits(), "a note or a description is not a commit").toEqual([]);
  expect(field(c, "Commit message").value, "the typed message waits").toBe("Add the thing");
});

test("Ctrl+Enter in the commit message commits with what was typed", async () => {
  const c = await mounted();
  await typeInto(c, field(c, "Commit message"), "Add the thing");
  await press(c, field(c, "Commit message"));
  await until(() => c.textContent.includes("Committed abc1234"));
  expect(commits()).toEqual([{ worktree: ROOT, message: "Add the thing" }]);
});

test("a keystroke still inside an input-method composition commits nothing", async () => {
  const c = await mounted();
  await typeInto(c, field(c, "Commit message"), "Add the thing");
  await press(c, field(c, "Commit message"), { isComposing: true });
  await settle(40);
  expect(commits()).toEqual([]);
});
