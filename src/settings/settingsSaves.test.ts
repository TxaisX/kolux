// T-598: Settings never lose what you typed or undo other changes. The real pages on the small DOM against an
// in-memory settings store; the stand-in settings_patch applies {set, remove} the way Rust does, and fails on demand.
//   F02-settings-update.2 (SET-036): a text field keeps its typed text when the save fails, and saves it on the next try.
//   F02-settings-update.3: the Appearance page writes only the fields it changed and follows saves made elsewhere.
//   F02-settings-update.4: switching an agent on or off sends only that switch.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, type FakeDocument, type FakeNode, find, fire, installDom, mount, settle, typeInto, until } from "../tasks/fakeDom";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  patches: [] as { set: Record<string, unknown>; remove: string[] }[],
  refuse: null as string | null,
  agents: [] as unknown[],
  heard: {} as Record<string, ((e: { payload: unknown }) => void)[]>,
  hold: null as Promise<void> | null, // while set, a save waits for it before it lands (a slow disk)
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "get_settings") return Promise.resolve(JSON.parse(JSON.stringify(h.settings)));
    if (cmd === "settings_patch") {
      if (h.refuse) return Promise.reject(h.refuse);
      const p = JSON.parse(JSON.stringify(args)) as { set: Record<string, unknown>; remove: string[] };
      const land = () => {
        h.patches.push(p);
        Object.assign(h.settings, p.set);
        for (const k of p.remove) delete h.settings[k];
        return null;
      };
      return h.hold ? h.hold.then(land) : Promise.resolve(land());
    }
    if (cmd === "agent_list") return Promise.resolve(JSON.parse(JSON.stringify(h.agents)));
    if (cmd === "agent_start_line") return Promise.resolve({ args: [], program: null });
    if (cmd === "agent_hooks_sync") return Promise.resolve([]);
    if (cmd === "agent_hooks_file") return Promise.resolve("settings.json");
    return Promise.reject("not stubbed");
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: () => Promise.resolve() }) }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, f: (e: { payload: unknown }) => void) => ((h.heard[name] ??= []).push(f), Promise.resolve(() => {})),
  emit: () => Promise.resolve(),
}));

let doc: FakeDocument;
let bus: Record<string, (() => void)[]> = {};
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  bus = {};
  Object.assign(dom.win, {
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    addEventListener: (t: string, f: () => void) => void (bus[t] ??= []).push(f),
    removeEventListener: (t: string, f: () => void) => void (bus[t] = (bus[t] ?? []).filter((x) => x !== f)),
    dispatchEvent: (e: { type: string }) => void (bus[e.type] ?? []).slice().forEach((f) => f()),
  });
  Object.assign(globalThis, { requestAnimationFrame: (f: () => void) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  Object.assign(doc.documentElement, { style: { setProperty() {}, removeProperty() {} }, dataset: {}, classList: { add() {}, remove() {} } });
  h.settings = {};
  h.patches = [];
  h.refuse = null;
  h.agents = [];
  h.heard = {};
  h.hold = null;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function show(page: Promise<{ default: () => unknown }>) {
  const { default: Page } = await page;
  const m = await mount(createElement(Page as () => null), doc);
  unmount = m.unmount;
  await settle(80);
  return m.container as FakeNode;
}
const field = (c: FakeNode, tag: string, label: string) => find(c, (n) => n.localName === tag && n.attrs["aria-label"] === label)[0];
const REFUSED = "settings.json could not be read, so nothing was saved";
const CLAUDE = { id: "claude", name: "Claude Code", program: "claude", args: [], installed: true, path: "/bin/claude" };
const CODEX = { id: "codex", name: "Codex", program: "codex", args: [], installed: true, path: "/bin/codex" };

// --- F02-settings-update.2 (SET-036) ---

test("Git page: a commit-instructions text that fails to save stays in the field, the page says why, and the next try saves it", async () => {
  const c = await show(import("./GitPage"));
  const box = () => field(c, "textarea", "commit message instructions");
  await until(() => !!box(), "the instructions field");
  h.refuse = REFUSED;
  await typeInto(c, box(), "Use the imperative mood");
  await fire(c, "focusout", box()); // leaving the field saves at once
  await settle(80);
  expect(box().value).toBe("Use the imperative mood");
  expect(c.textContent).toContain(REFUSED);
  expect(h.settings.commitWriterInstructions).toBeUndefined();
  h.refuse = null;
  await fire(c, "focusout", box());
  await until(() => h.settings.commitWriterInstructions === "Use the imperative mood", "the second try");
  expect(box().value).toBe("Use the imperative mood");
  expect(c.textContent).not.toContain(REFUSED);
});

test("Agents page: default arguments that fail to save stay in the field for another try", async () => {
  h.agents = [CLAUDE];
  const c = await show(import("./AgentsPage"));
  const box = () => field(c, "input", "Default arguments");
  await until(() => !!box(), "the Default arguments field");
  h.refuse = REFUSED;
  await typeInto(c, box(), "--verbose");
  await fire(c, "focusout", box());
  await settle(80);
  expect(box().value).toBe("--verbose");
  expect(c.textContent).toContain(REFUSED);
  h.refuse = null;
  await fire(c, "focusout", box());
  await until(() => JSON.stringify(h.settings.agentOptions) === JSON.stringify({ claude: { args: "--verbose" } }), "the second try");
  expect(box().value).toBe("--verbose");
});

// --- F02-settings-update.3 ---

const swatch = (c: FakeNode, label: string) => find(c, (n) => n.attrs.role === "radio" && n.attrs["aria-label"] === label)[0];

test("Appearance page: a change writes only the field it changed, so a terminal size saved elsewhere meanwhile stays", async () => {
  h.settings = { terminalFontSize: 13 };
  const c = await show(import("./AppearancePage"));
  await until(() => !!swatch(c, "Teal"), "the colour themes");
  h.settings.terminalFontSize = 16; // the Terminal card (or a writer that announces nothing) saved 16 meanwhile
  await click(c, swatch(c, "Teal"));
  await until(() => h.patches.length > 0, "the save after the pause");
  await settle(300);
  expect(h.patches).toEqual([{ set: { appTheme: "teal" }, remove: [] }]);
  expect(h.settings.terminalFontSize).toBe(16);
});

test("Appearance page: it follows a save made on another page, so a later change neither shows nor writes the old value", async () => {
  h.settings = { terminalFontSize: 13 };
  const c = await show(import("./AppearancePage"));
  await until(() => !!swatch(c, "Teal"), "the colour themes");
  expect(c.textContent).toContain("13 pt");
  h.settings.terminalFontSize = 16;
  await until(() => !!h.heard["settings-saved"], "the page listening for saves");
  for (const f of h.heard["settings-saved"]) f({ payload: { set: { terminalFontSize: 16 }, remove: [] } }); // what Rust sends every window
  await settle();
  expect(c.textContent).toContain("16 pt");
  await click(c, swatch(c, "Teal"));
  await until(() => h.patches.length > 0, "the save after the pause");
  await settle(300);
  expect(h.patches.flatMap((p) => Object.keys(p.set))).toEqual(["appTheme"]);
  expect(h.settings.terminalFontSize).toBe(16);
});

test("Appearance page: a change made while the one before is still saving is written too, so the last look is the one kept", async () => {
  const c = await show(import("./AppearancePage"));
  await until(() => !!swatch(c, "Teal"), "the colour themes");
  const on = (n: FakeNode) => n.attrs.role === "radio" && !!n.attrs["aria-label"] && String(n.attrs["aria-checked"]) === "true";
  const firstLabel = String(find(c, on)[0]?.attrs["aria-label"]); // the theme shown at first
  expect(firstLabel).not.toBe("Teal");
  let release = () => {};
  h.hold = new Promise<void>((r) => (release = r)); // the first save stays open on a slow disk
  await click(c, swatch(c, "Teal"));
  await settle(300); // past the pause: the Teal save is sent and waits
  await click(c, swatch(c, firstLabel)); // back to the first theme while Teal is still saving
  await settle(300); // past the pause again
  h.hold = null;
  release();
  await settle(150);
  expect(h.patches).toHaveLength(2); // the second change is written, not lost as "no change" against the old base
  expect(h.patches[0].set).toEqual({ appTheme: "teal" });
  expect(h.settings.appTheme).not.toBe("teal");
  expect(String(find(c, on)[0]?.attrs["aria-label"])).toBe(firstLabel);
});

// --- F02-settings-update.4 ---

test("Agents page: switching an agent off sends only that switch, so a hooks switch turned off elsewhere stays off", async () => {
  h.settings = { agentStatusHooks: true, codexSessionsHome: "C:/old" };
  h.agents = [CLAUDE, CODEX];
  const c = await show(import("./AgentsPage"));
  const sw = () => find(find(c, (n) => n.attrs["data-agent"] === "codex")[0], (n) => n.localName === "input" && n.attrs.role === "switch")[0];
  await until(() => !!sw(), "the Codex switch");
  // Written meanwhile by something that announces nothing: `kolux agent hooks off`, a reset of the Codex folder.
  h.settings.agentStatusHooks = false;
  delete h.settings.codexSessionsHome;
  (sw() as unknown as { checked: boolean }).checked = false; // the user's click turns the box off before React reads it
  await click(c, sw());
  await until(() => h.patches.length > 0, "the switch to be saved");
  await settle(80);
  expect(h.patches.map((p) => p.set)).toEqual([{ disabledAgents: ["codex"] }]);
  expect(h.settings).toEqual({ agentStatusHooks: false, disabledAgents: ["codex"] });
});

// T-723 (DT-C159): the zoom control used to drop a failed save, so the size looked kept but reset at the next start.
test("Appearance page: a zoom step that fails to save says so under the zoom control, and the next good step clears it", async () => {
  const c = await show(import("./AppearancePage"));
  const alerts = () => find(c, (n) => n.attrs.role === "alert" && (n.textContent ?? "").includes("Zoom not saved"));
  await until(() => !!field(c, "button", "Zoom in"), "the zoom control");
  h.refuse = REFUSED;
  await click(c, field(c, "button", "Zoom in"));
  await until(() => alerts().length === 1, "the zoom warning");
  expect(alerts()[0].textContent).toContain(REFUSED);
  h.refuse = null;
  await click(c, field(c, "button", "Zoom out"));
  await settle(50);
  expect(alerts()).toEqual([]);
  expect(h.patches[h.patches.length - 1]).toEqual({ set: { uiZoom: 0 }, remove: [] });
});
