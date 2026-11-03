// T-702 (DT-C138): the earlier UI audit only ever verified the "More actions" button on the Skills page.
// Every other control is driven here through its real handler in the mounted page, and each test asserts what
// the person sees change (a menu, a row list, a status line, a dialog) or the app command that goes out.
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeNode, byLabel, byText, click, find, installDom, mount, settle, typeInto, until, type FakeDocument } from "../tasks/fakeDom";
import { INSTALL_DETAIL, SKILLS_SHOW_EVENT } from "./skillBarStore";
import { BLOCKED, COPIED, COPY_FAILED, DELETE_NONE_ELIGIBLE, INSTALL_NO_SKILLS, QUERY_LIMIT, type Root, type Scan, type Skill } from "./skills";

const skill = (name: string, source: Skill["source"], agents: Skill["agents"], extra: Partial<Skill> = {}): Skill => ({
  name,
  description: `${name} does one thing`,
  updated: Date.UTC(2026, 9, 1),
  path: source === "bundled" ? `kolux://bundled/${name}` : `/${source}/skills/${name}/SKILL.md`,
  source,
  agents,
  plugin: null,
  ...extra,
});
const ALPHA = skill("alpha-home", "home", ["claude", "codex", "shared"]);
const BETA = skill("beta-work", "workspace", ["claude"]);
const GAMMA = skill("gamma-plugin", "plugin", ["claude"], { plugin: "tools" });
const KOLUX = skill("kolux-bundled", "bundled", ["claude"]);
const ROOTS: Root[] = [
  { path: "/home/skills", label: "Home skills", source: "home", agents: ["claude"], state: "scanned", count: 1, note: null },
  { path: "/w/.claude/skills", label: "Project skills", source: "workspace", agents: ["claude"], state: "not-found", count: 0, note: null },
  { path: "", label: "Built into Kolux", source: "bundled", agents: [], state: "scanned", count: 1, note: null },
];
const FULL: Scan = { skills: [ALPHA, BETA, GAMMA, KOLUX], roots: ROOTS };
const CHECKED = { report: { rows: [], available: 0, revisions: [], notice: [] }, dismissed: [] };

const calls: Array<[string, Record<string, unknown>]> = [];
let scanResult: Scan = FULL;
let scanFail: string | null = null; // while set, skills_scan rejects with it
let firstGate: Promise<void> | null = null; // holds the first (non-refresh) scan
let refreshGate: Promise<void> | null = null; // holds scans asked with refresh:true
let revealFail: string | null = null;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    calls.push([cmd, args]);
    if (cmd === "skills_scan") {
      if (args.refresh ? refreshGate : firstGate) await (args.refresh ? refreshGate : firstGate);
      if (scanFail) throw scanFail;
      return scanResult;
    }
    if (cmd === "skills_update_check") return CHECKED;
    if (cmd === "skills_update_status") return { state: "idle", names: [], command: "", log: "", code: null, stopped: false, error: null, results: [] };
    if (cmd === "skills_delete_plan") {
      const picks = args.picks as Array<{ path: string }>;
      return picks.map((p) => ({ path: p.path, blocked: null, items: [{ path: p.path, kind: "folder" }], remains: null }));
    }
    if (cmd === "skills_delete") return (args.picks as Array<{ path: string }>).map((p) => ({ path: p.path, outcome: "deleted", note: null }));
    if (cmd === "skills_reveal" && revealFail) throw revealFail;
    if (cmd === "skills_install_command") return "npx skills add";
    return null;
  },
}));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

let doc: FakeDocument;
let written: string[];
let copyFails: boolean;
beforeEach(() => {
  calls.length = 0;
  scanResult = FULL;
  scanFail = null;
  firstGate = null;
  refreshGate = null;
  revealFail = null;
  written = [];
  copyFails = false;
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, innerWidth: 1200, innerHeight: 800 });
  // The page raises and hears window events (the Install entry, the Escape keys), so the window routes them for real.
  const heard = new Map<string, Set<(e: unknown) => void>>();
  dom.win.addEventListener = (t: string, fn: (e: unknown) => void) => void (heard.get(t) ?? heard.set(t, new Set()).get(t)!).add(fn);
  dom.win.removeEventListener = (t: string, fn: (e: unknown) => void) => void heard.get(t)?.delete(fn);
  dom.win.dispatchEvent = (e: { type: string }) => {
    for (const fn of [...(heard.get(e.type) ?? [])]) fn(e);
    return true;
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.localStorage = dom.win.localStorage;
  g.HTMLElement = FakeNode;
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "node", clipboard: { writeText: (t: string) => (copyFails ? Promise.reject(new Error("denied")) : (written.push(t), Promise.resolve())) } },
  });
  (doc as unknown as { visibilityState: string }).visibilityState = "visible";
  const proto = FakeNode.prototype as unknown as Record<string, unknown>;
  proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 24, bottom: 24, width: 24, height: 24 });
  proto.getClientRects = () => [];
  proto.setSelectionRange = () => {};
  proto.select = () => {};
  proto.scrollIntoView = () => {};
  // The menus' keys (menuFocus) look up their rows; the page's dialogs look for hidden panels around them.
  proto.querySelectorAll = function (this: FakeNode) {
    return find(this, (n) => (n.attrs.role ?? "").startsWith("menuitem"));
  };
  proto.closest = () => null;
  proto.querySelector = () => null;
});

type Root_ = FakeNode;
const button = (root: Root_, label: string) => {
  const b = byLabel(root, "button", label)[0] ?? byText(root, "button", label)[0];
  if (!b) throw new Error(`no button named ${label}`);
  return b;
};
const names = (root: Root_) => find(root, (n) => n.attrs.class === "skills-row").map((row) => find(row, (n) => n.attrs.class === "name")[0].textContent);
const menu = (root: Root_, label: string) => find(root, (n) => n.attrs.role === "menu" && n.attrs["aria-label"] === label)[0];
const items = (m: Root_) => find(m, (n) => (n.attrs.role ?? "").startsWith("menuitem"));
const item = (m: Root_, text: string) => {
  const i = items(m).find((n) => n.textContent.replace("✓", "").trim() === text);
  if (!i) throw new Error(`no menu item ${text}`);
  return i;
};
const chip = (root: Root_, label: string) => find(root, (n) => n.localName === "button" && n.attrs["aria-pressed"] !== undefined && n.textContent.startsWith(label))[0];
const agentButton = (root: Root_) => find(root, (n) => n.localName === "button" && n.attrs["aria-haspopup"] === "menu" && (n.attrs["aria-label"] ?? "").startsWith("Filter by agent"))[0];
const search = (root: Root_) => byLabel(root, "input", "Search skills")[0];
const body = (root: Root_) => find(root, (n) => n.attrs.class === "skills-body")[0];
const dialog = (root: Root_, label: string) => find(root, (n) => (n.attrs.role === "dialog" || n.attrs.role === "alertdialog") && n.attrs["aria-label"] === label)[0];
const status = (root: Root_) => find(root, (n) => n.attrs.role === "status").map((n) => n.textContent);
const toolbar = (root: Root_) => find(root, (n) => n.attrs.role === "toolbar" && n.attrs["aria-label"] === "Choose skills to delete")[0];
/** The toolbar's Refresh button, found by its title because its words change while it scans. */
const refresh = (root: Root_) => find(root, (n) => n.localName === "button" && n.attrs.title === "Scan every folder again")[0];
const spins = (b: Root_) => find(b, (n) => (n.attrs.class ?? "").includes("spin")).length;
const disabled = (n: Root_) => "disabled" in n.attrs || n.disabled === true;

async function page(onClose: () => void = () => {}) {
  const { default: SkillsPage } = await import("./SkillsPage");
  const m = await mount(createElement(SkillsPage, { workspace: "/w", onClose }), doc);
  await until(() => names(m.container).length > 0 || !!find(m.container, (n) => n.attrs.class === "empty" && n.textContent.includes("No skills found")).length || !!find(m.container, (n) => n.attrs.role === "alert").length, "the scan to show");
  return m;
}
async function openRowMenu(c: Root_, name: string) {
  await click(c, button(c, `Actions for ${name}`));
  const m = menu(c, `Actions for ${name}`);
  expect(m).toBeTruthy();
  return m;
}

describe("T-702 Skills header", () => {
  it("Close Skills calls onClose", async () => {
    const onClose = vi.fn();
    const { container } = await page(onClose);
    await click(container, button(container, "Close Skills"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("More actions opens a two-item menu (aria-expanded) and a second click closes it", async () => {
    const { container } = await page();
    expect(button(container, "More actions").attrs["aria-expanded"]).toBe("false");
    await click(container, button(container, "More actions"));
    expect(button(container, "More actions").attrs["aria-expanded"]).toBe("true");
    expect(items(menu(container, "More actions")).map((n) => n.textContent)).toEqual(["Install / reinstall Kolux skills", "Delete skills"]);
    await click(container, button(container, "More actions"));
    expect(menu(container, "More actions")).toBeUndefined();
    expect(button(container, "More actions").attrs["aria-expanded"]).toBe("false");
  });

  it("More actions > Install / reinstall Kolux skills raises the show event (Install panel), closes the menu and opens the Update dialog", async () => {
    const { container } = await page();
    const heard = vi.fn();
    (window as unknown as { addEventListener: (t: string, f: (e: unknown) => void) => void }).addEventListener(SKILLS_SHOW_EVENT, heard);
    await click(container, button(container, "More actions"));
    await click(container, item(menu(container, "More actions"), "Install / reinstall Kolux skills"));
    expect(heard).toHaveBeenCalledTimes(1);
    expect((heard.mock.calls[0][0] as { detail: string }).detail).toBe(INSTALL_DETAIL);
    expect(menu(container, "More actions")).toBeUndefined();
    await until(() => !!dialog(container, "Update Kolux skills"), "the Update dialog");
  });

  it("More actions > Delete skills enters picking mode: the toolbar appears and the menu closes", async () => {
    const { container } = await page();
    expect(toolbar(container)).toBeUndefined();
    await click(container, button(container, "More actions"));
    await click(container, item(menu(container, "More actions"), "Delete skills"));
    expect(toolbar(container)).toBeTruthy();
    expect(status(container)).toContain("0 selected");
    expect(menu(container, "More actions")).toBeUndefined();
  });

  it("More actions explains why Install and Delete are off when the scan has no bundled and no deletable skills", async () => {
    scanResult = { skills: [GAMMA], roots: ROOTS };
    const { container } = await page();
    await click(container, button(container, "More actions"));
    const install = item(menu(container, "More actions"), "Install / reinstall Kolux skills");
    const del = item(menu(container, "More actions"), "Delete skills");
    expect(disabled(install)).toBe(true);
    expect(install.attrs.title).toBe(INSTALL_NO_SKILLS);
    expect(disabled(del)).toBe(true);
    expect(del.attrs.title).toBe(DELETE_NONE_ELIGIBLE);
    await click(container, del);
    expect(toolbar(container)).toBeUndefined();
  });
});

describe("T-702 Skills filters", () => {
  it("Search skills filters the rows as you type, and emptying it brings them back", async () => {
    const { container } = await page();
    expect(names(container)).toEqual(["alpha-home", "beta-work", "gamma-plugin", "kolux-bundled"]);
    await typeInto(container, search(container), "BETA");
    expect(names(container)).toEqual(["beta-work"]);
    await typeInto(container, search(container), "");
    expect(names(container)).toHaveLength(4);
  });

  it("Search skills refuses a search over the 200-character limit with a status line and keeps the list as it was", async () => {
    const { container } = await page();
    await typeInto(container, search(container), "alpha");
    await typeInto(container, search(container), "x".repeat(QUERY_LIMIT + 1));
    expect(status(container)).toContain(`That search is too long; searches are at most ${QUERY_LIMIT} characters.`);
    expect(names(container)).toEqual(["alpha-home"]);
    await typeInto(container, search(container), "x".repeat(QUERY_LIMIT));
    expect(status(container).some((s) => s.includes("too long"))).toBe(false);
    expect(find(container, (n) => n.attrs.class === "empty" && n.textContent.includes("No matches")).length).toBe(1);
  });

  it("Filter by agent opens a menu of radio items; choosing Codex filters the rows, relabels the button and follows aria-checked", async () => {
    const { container } = await page();
    expect(agentButton(container).textContent.trim()).toBe("Filter by agent");
    expect(agentButton(container).attrs["aria-label"]).toBe("Filter by agent");
    await click(container, agentButton(container));
    expect(agentButton(container).attrs["aria-expanded"]).toBe("true");
    const radios = items(menu(container, "Filter by agent"));
    expect(radios.map((n) => n.attrs.role)).toEqual(Array(6).fill("menuitemradio"));
    expect(radios.map((n) => n.textContent.replace("✓", ""))).toEqual(["All agents", "Claude Code", "Codex", "Grok", "Hermes", "Shared skills folder"]);
    expect(radios.map((n) => n.attrs["aria-checked"])).toEqual(["true", "false", "false", "false", "false", "false"]);
    await click(container, item(menu(container, "Filter by agent"), "Codex"));
    expect(menu(container, "Filter by agent")).toBeUndefined();
    expect(names(container)).toEqual(["alpha-home"]);
    expect(agentButton(container).textContent.trim()).toBe("Codex");
    expect(agentButton(container).attrs["aria-label"]).toBe("Filter by agent: Codex"); // the name keeps saying it is a filter
    await click(container, agentButton(container));
    expect(items(menu(container, "Filter by agent")).map((n) => n.attrs["aria-checked"])).toEqual(["false", "false", "true", "false", "false", "false"]);
    await click(container, item(menu(container, "Filter by agent"), "All agents"));
    expect(names(container)).toHaveLength(4);
  });

  it.each([
    ["Home", ["alpha-home"]],
    ["Workspace", ["beta-work"]],
    ["Bundled", ["kolux-bundled"]],
    ["Plugin", ["gamma-plugin"]],
  ])("Source chip %s flips aria-pressed, filters the rows, and a second click turns it off", async (label, rows) => {
    const { container } = await page();
    expect(chip(container, label).attrs["aria-pressed"]).toBe("false");
    expect(chip(container, label).textContent).toBe(`${label} 1`);
    await click(container, chip(container, label));
    expect(chip(container, label).attrs["aria-pressed"]).toBe("true");
    expect(names(container)).toEqual(rows);
    await click(container, chip(container, label));
    expect(chip(container, label).attrs["aria-pressed"]).toBe("false");
    expect(names(container)).toHaveLength(4);
  });

  it("Clear filters appears with any filter on and resets the search, the agent and the chips together", async () => {
    const { container } = await page();
    expect(byText(container, "button", "Clear filters")).toHaveLength(0);
    await typeInto(container, search(container), "a");
    await click(container, chip(container, "Home"));
    await click(container, agentButton(container));
    await click(container, item(menu(container, "Filter by agent"), "Claude Code"));
    expect(byText(container, "button", "Clear filters")).toHaveLength(1);
    await click(container, byText(container, "button", "Clear filters")[0]);
    expect(byText(container, "button", "Clear filters")).toHaveLength(0);
    expect(search(container).value).toBe("");
    expect(chip(container, "Home").attrs["aria-pressed"]).toBe("false");
    expect(agentButton(container).textContent.trim()).toBe("Filter by agent");
    expect(names(container)).toHaveLength(4);
  });

  it("Skill folders opens a dialog listing every folder and how it scanned; a second click, or the backdrop, closes it", async () => {
    const { container } = await page();
    expect(dialog(container, "Skill folders")).toBeUndefined();
    await click(container, button(container, "Skill folders"));
    const d = dialog(container, "Skill folders");
    expect(d).toBeTruthy();
    expect(button(container, "Skill folders").attrs["aria-expanded"]).toBe("true");
    const text = d.textContent;
    expect(text).toContain("Home skills1 skill");
    expect(text).toContain("Project skillsNot found");
    expect(text).toContain("Built into Kolux1 skill");
    expect(text).toContain("/home/skills");
    await click(container, button(container, "Skill folders"));
    expect(dialog(container, "Skill folders")).toBeUndefined();
    await click(container, button(container, "Skill folders"));
    await click(container, find(container, (n) => n.attrs.class === "menu-backdrop")[0]);
    expect(dialog(container, "Skill folders")).toBeUndefined();
  });
});

describe("T-702 Skills Refresh and scan states", () => {
  it("Refresh scans every folder again, busy and spinning with 'Scanning…' until the scan is back", async () => {
    const { container } = await page();
    const b = () => refresh(container);
    expect(b().attrs["aria-busy"]).toBe("false");
    expect(spins(b())).toBe(0);
    expect(calls.filter(([c]) => c === "skills_scan").map(([, a]) => a.refresh)).toEqual([false]);
    let open!: () => void;
    refreshGate = new Promise((r) => (open = r));
    await click(container, b());
    expect(calls.filter(([c]) => c === "skills_scan").pop()).toEqual(["skills_scan", { workspace: "/w", refresh: true }]);
    expect(b().attrs["aria-busy"]).toBe("true");
    expect(spins(b())).toBe(1);
    expect(b().textContent.trim()).toBe("Scanning…");
    expect(disabled(b())).toBe(true);
    expect(names(container)).toHaveLength(4); // the list stays up while it rescans
    open();
    await until(() => b().textContent.trim() === "Refresh", "the scan to end");
    expect(b().attrs["aria-busy"]).toBe("false");
    expect(spins(b())).toBe(0);
    expect(disabled(b())).toBe(false);
  });

  it("The first scan shows 'Scanning skill folders…' and a busy Refresh, then the list", async () => {
    let open!: () => void;
    firstGate = new Promise((r) => (open = r));
    const { default: SkillsPage } = await import("./SkillsPage");
    const { container } = await mount(createElement(SkillsPage, { workspace: "/w", onClose: () => {} }), doc);
    await settle();
    expect(body(container).textContent).toContain("Scanning skill folders…");
    expect(refresh(container).attrs["aria-busy"]).toBe("true");
    expect(refresh(container).textContent.trim()).toBe("Scanning…");
    expect(spins(refresh(container))).toBe(1);
    open();
    await until(() => names(container).length === 4, "the list");
    expect(refresh(container).attrs["aria-busy"]).toBe("false");
    expect(refresh(container).textContent.trim()).toBe("Refresh");
  });

  it("A failed scan shows 'Scan failed' with the reason and Retry, and Retry scans again with refresh:true", async () => {
    scanFail = "disk offline";
    const { container } = await page();
    const alert = find(container, (n) => n.attrs.role === "alert")[0];
    expect(alert.textContent).toContain("Scan failed");
    expect(alert.textContent).toContain("disk offline");
    scanFail = null;
    const before = calls.filter(([c]) => c === "skills_scan").length;
    await click(container, button(alert, "Retry"));
    await until(() => names(container).length === 4, "the retry to show the list");
    expect(calls.filter(([c]) => c === "skills_scan").slice(before)).toEqual([["skills_scan", { workspace: "/w", refresh: true }]]);
    expect(find(container, (n) => n.attrs.role === "alert")).toHaveLength(0);
  });

  it("A folder that errored makes the scan a failure that names the folder, never a shorter list", async () => {
    scanResult = { skills: [ALPHA], roots: [{ ...ROOTS[0], state: "error", note: "access denied" }] };
    const { container } = await page();
    const alert = find(container, (n) => n.attrs.role === "alert")[0];
    expect(alert.textContent).toContain("Home skills: access denied");
    expect(names(container)).toHaveLength(0);
    expect(byText(alert, "button", "Retry")).toHaveLength(1);
  });

  it("An empty scan shows 'No skills found' with its own Refresh, which rescans with refresh:true", async () => {
    scanResult = { skills: [], roots: ROOTS };
    const { container } = await page();
    const empty = find(body(container), (n) => n.attrs.class === "empty")[0];
    expect(empty.textContent).toContain("No skills found");
    const before = calls.filter(([c]) => c === "skills_scan").length;
    scanResult = FULL;
    await click(container, byText(empty, "button", "Refresh")[0]);
    await until(() => names(container).length === 4, "the rescan to find skills");
    expect(calls.filter(([c]) => c === "skills_scan").slice(before)).toEqual([["skills_scan", { workspace: "/w", refresh: true }]]);
  });

  it("A filter that matches nothing shows 'No matches' with Clear filters, which brings the list back", async () => {
    const { container } = await page();
    await typeInto(container, search(container), "zzzz-nothing");
    const none = find(body(container), (n) => n.attrs.class === "empty")[0];
    expect(none.textContent).toContain("No matches");
    expect(names(container)).toHaveLength(0);
    await click(container, byText(none, "button", "Clear filters")[0]);
    expect(names(container)).toHaveLength(4);
    expect(search(container).value).toBe("");
  });
});

describe("T-702 Skills picking mode", () => {
  async function picking() {
    const m = await page();
    await click(m.container, button(m.container, "More actions"));
    await click(m.container, item(menu(m.container, "More actions"), "Delete skills"));
    return m;
  }
  const box = (c: Root_, name: string) => byLabel(c, "input", `Choose ${name}`)[0];

  it("Choose <name> checkboxes toggle the selected count; bundled and plugin rows are off and say why", async () => {
    const { container } = await picking();
    expect(box(container, "alpha-home").checked).toBe(false);
    await click(container, box(container, "alpha-home"));
    expect(box(container, "alpha-home").checked).toBe(true);
    expect(status(container)).toContain("1 selected");
    await click(container, box(container, "beta-work"));
    expect(status(container)).toContain("2 selected");
    await click(container, box(container, "alpha-home"));
    expect(box(container, "alpha-home").checked).toBe(false);
    expect(status(container)).toContain("1 selected");
    expect(disabled(box(container, "kolux-bundled"))).toBe(true);
    expect(box(container, "kolux-bundled").attrs.title).toBe(BLOCKED.bundled);
    expect(disabled(box(container, "gamma-plugin"))).toBe(true);
    expect(box(container, "gamma-plugin").attrs.title).toBe(BLOCKED.plugin);
  });

  it("Select all eligible chooses only the rows that can go; Clear empties the choice and turns itself off", async () => {
    const { container } = await picking();
    const clear = () => byText(toolbar(container), "button", "Clear")[0];
    expect(disabled(clear())).toBe(true);
    await click(container, byText(toolbar(container), "button", "Select all eligible")[0]);
    expect(status(container)).toContain("2 selected");
    expect(box(container, "alpha-home").checked).toBe(true);
    expect(box(container, "beta-work").checked).toBe(true);
    expect(box(container, "gamma-plugin").checked).toBe(false);
    expect(disabled(clear())).toBe(false);
    await click(container, clear());
    expect(status(container)).toContain("0 selected");
    expect(box(container, "alpha-home").checked).toBe(false);
    expect(disabled(clear())).toBe(true);
  });

  it("Delete… is off with nothing chosen; with two chosen it asks skills_delete_plan and opens the confirmation, whose Cancel backs out", async () => {
    const { container } = await picking();
    const del = () => byText(toolbar(container), "button", "Delete…")[0];
    expect(disabled(del())).toBe(true);
    await click(container, byText(toolbar(container), "button", "Select all eligible")[0]);
    expect(disabled(del())).toBe(false);
    await click(container, del());
    await until(() => !!dialog(container, "Delete 2 skills?"), "the confirmation");
    const plan = calls.find(([c]) => c === "skills_delete_plan")!;
    expect(plan[1]).toEqual({ workspace: "/w", picks: [ALPHA, BETA].map((s) => ({ path: s.path, updated: s.updated })) });
    expect(dialog(container, "Delete 2 skills?").textContent).toContain("This cannot be undone.");
    await click(container, byText(dialog(container, "Delete 2 skills?"), "button", "Cancel")[0]);
    expect(dialog(container, "Delete 2 skills?")).toBeUndefined();
    expect(toolbar(container)).toBeTruthy(); // the choice is kept
  });

  it("Confirming Delete runs skills_delete, shows each outcome and rescans", async () => {
    const { container } = await picking();
    await click(container, box(container, "alpha-home"));
    await click(container, byText(toolbar(container), "button", "Delete…")[0]);
    await until(() => !!dialog(container, "Delete 1 skill?"), "the confirmation");
    const scansBefore = calls.filter(([c]) => c === "skills_scan").length;
    await click(container, byText(dialog(container, "Delete 1 skill?"), "button", "Delete")[0]);
    await until(() => !!dialog(container, "Delete finished"), "the outcome");
    expect(dialog(container, "Delete finished").textContent).toContain("alpha-home: Deleted");
    expect(calls.find(([c]) => c === "skills_delete")![1]).toEqual({ workspace: "/w", picks: [{ path: ALPHA.path, updated: ALPHA.updated }] });
    await until(() => calls.filter(([c]) => c === "skills_scan").length > scansBefore, "the rescan");
    expect(toolbar(container)).toBeUndefined(); // the selection ends with the delete
  });

  it("Exit selection leaves picking mode: the toolbar and the checkboxes go", async () => {
    const { container } = await picking();
    expect(box(container, "alpha-home")).toBeTruthy();
    await click(container, byText(toolbar(container), "button", "Exit selection")[0]);
    expect(toolbar(container)).toBeUndefined();
    expect(box(container, "alpha-home")).toBeUndefined();
  });
});

describe("T-702 Skills row actions", () => {
  it("Actions for <name> opens a menu of View details, Reveal file, Copy path and Delete (aria-expanded), and a second click closes it", async () => {
    const { container } = await page();
    const m = await openRowMenu(container, "alpha-home");
    expect(items(m).map((n) => n.textContent)).toEqual(["View details", "Reveal file", "Copy path", "Delete"]);
    expect(items(m).every((n) => !disabled(n))).toBe(true);
    expect(button(container, "Actions for alpha-home").attrs["aria-expanded"]).toBe("true");
    await click(container, button(container, "Actions for alpha-home"));
    expect(menu(container, "Actions for alpha-home")).toBeUndefined();
  });

  it("A bundled row's menu turns off Reveal file, Copy path and Delete and says why", async () => {
    const { container } = await page();
    const m = await openRowMenu(container, "kolux-bundled");
    for (const t of ["Reveal file", "Copy path"]) {
      expect(disabled(item(m, t))).toBe(true);
      expect(item(m, t).attrs.title).toBe("Built into Kolux; there is no file on disk");
    }
    expect(disabled(item(m, "Delete"))).toBe(true);
    expect(item(m, "Delete").attrs.title).toBe(BLOCKED.bundled);
    expect(disabled(item(m, "View details"))).toBe(false);
  });

  it("View details opens the details dialog (who uses it, when, where) and its OK closes it", async () => {
    const { container } = await page();
    await click(container, item(await openRowMenu(container, "alpha-home"), "View details"));
    expect(menu(container, "Actions for alpha-home")).toBeUndefined();
    const d = dialog(container, "alpha-home");
    expect(d).toBeTruthy();
    expect(d.textContent).toContain("Used by: Claude Code, Codex, Shared skills folder");
    expect(d.textContent).toContain(ALPHA.path);
    await click(container, byText(d, "button", "OK")[0]);
    expect(dialog(container, "alpha-home")).toBeUndefined();
  });

  it("Reveal file asks the app to show the file, and says so in a toast when the app refuses", async () => {
    const { container } = await page();
    await click(container, item(await openRowMenu(container, "beta-work"), "Reveal file"));
    expect(calls.find(([c]) => c === "skills_reveal")![1]).toEqual({ workspace: "/w", path: BETA.path });
    expect(menu(container, "Actions for beta-work")).toBeUndefined();
    revealFail = "no such file";
    await click(container, item(await openRowMenu(container, "beta-work"), "Reveal file"));
    await until(() => status(container).includes("no such file"), "the refusal toast");
  });

  it("Copy path puts the path on the clipboard and shows the 'Path copied' toast; a refused clipboard says so", async () => {
    const { container } = await page();
    await click(container, item(await openRowMenu(container, "beta-work"), "Copy path"));
    expect(written).toEqual([BETA.path]);
    await until(() => status(container).includes(COPIED), "the copied toast");
    copyFails = true;
    await click(container, item(await openRowMenu(container, "alpha-home"), "Copy path"));
    await until(() => status(container).includes(COPY_FAILED), "the failure toast");
  });

  it("Delete in a row menu plans that one delete and opens its confirmation", async () => {
    const { container } = await page();
    await click(container, item(await openRowMenu(container, "beta-work"), "Delete"));
    await until(() => !!dialog(container, "Delete 1 skill?"), "the confirmation");
    expect(calls.find(([c]) => c === "skills_delete_plan")![1]).toEqual({ workspace: "/w", picks: [{ path: BETA.path, updated: BETA.updated }] });
  });

  it("The details dialog's Copy path, Reveal file and Delete run the same actions", async () => {
    const { container } = await page();
    await click(container, item(await openRowMenu(container, "alpha-home"), "View details"));
    const d = () => dialog(container, "alpha-home");
    await click(container, byText(d(), "button", "Copy path")[0]);
    expect(written).toEqual([ALPHA.path]);
    await click(container, byText(d(), "button", "Reveal file")[0]);
    expect(calls.find(([c]) => c === "skills_reveal")![1]).toEqual({ workspace: "/w", path: ALPHA.path });
    await click(container, byText(d(), "button", "Delete")[0]);
    await until(() => !!dialog(container, "Delete 1 skill?"), "the confirmation");
    expect(d()).toBeUndefined(); // the details close as the delete opens
  });
});
