// SET-027 acceptance: the real AgentsPage on the small DOM against an in-memory settings store, then the product's own
// list rules (offeredAgents, defaultAgentId, menuAgents) on what that page saved.
// MIRROR src/App.tsx:890-892 (tab.newAgent: `defaultId ? agents.find(id match && installed) : agents.find(installed)`), copied below as `newAgentOpens`;
// the page, the settings rules and the menu order are the product's. The stand-in settings_patch applies {set, remove} the way Rust does.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AgentInfo } from "../../launch/PlusMenu";
import { defaultAgentId, menuAgents, offeredAgents } from "../../launch/agents";
import { click, type FakeDocument, type FakeNode, find, installDom, mount, settle, until } from "../../test/fakeDom";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  agents: [] as unknown[],
  patches: [] as { set: Record<string, unknown>; remove: string[] }[],
  lists: 0,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    if (cmd === "get_settings") return Promise.resolve(JSON.parse(JSON.stringify(h.settings)));
    if (cmd === "settings_patch") {
      const p = args as { set: Record<string, unknown>; remove: string[] };
      h.patches.push(JSON.parse(JSON.stringify(p)));
      Object.assign(h.settings, p.set);
      for (const k of p.remove) delete h.settings[k];
      return Promise.resolve(null);
    }
    if (cmd === "agent_list") {
      h.lists++;
      return Promise.resolve(JSON.parse(JSON.stringify(h.agents)));
    }
    if (cmd === "agent_start_line") return Promise.resolve({ args: [], program: null });
    if (cmd === "agent_hooks_sync") return Promise.resolve([]);
    if (cmd === "agent_hooks_file") return Promise.resolve("settings.json");
    return Promise.reject("not stubbed");
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));

const agent = (id: string, name: string, installed: boolean): AgentInfo => ({ id, name, program: id, args: [], installed, path: installed ? `/bin/${id}` : null });
const CLAUDE = agent("claude", "Claude Code", true);
const CODEX = agent("codex", "Codex", true);

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(() => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout });
  Object.assign(doc, { querySelectorAll: () => [], querySelector: () => null, visibilityState: "visible", hidden: false });
  h.settings = {};
  h.agents = [];
  h.patches = [];
  h.lists = 0;
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

async function page() {
  const { default: AgentsPage } = await import("../AgentsPage");
  const m = await mount(createElement(AgentsPage), doc);
  unmount = m.unmount;
  await settle(80);
  return m.container as FakeNode;
}
const row = (c: FakeNode, id: string) => find(c, (n) => n.attrs["data-agent"] === id)[0];
const switchOf = (c: FakeNode, id: string) => find(row(c, id), (n) => n.localName === "input" && n.attrs.role === "switch")[0];
const select = (c: FakeNode) => find(c, (n) => n.localName === "select" && n.attrs["aria-label"] === "default agent")[0];
const optionTexts = (c: FakeNode) => find(select(c), (n) => n.localName === "option").map((o) => o.textContent.trim());
const refreshButton = (c: FakeNode) => find(c, (n) => n.localName === "button" && /^(Refresh|Looking…)$/.test(n.textContent.trim()))[0];
const chips = (c: FakeNode) => find(c, (n) => String(n.attrs.className ?? n.attrs.class ?? "") === "conn-chip").map((n) => n.textContent.trim());
/** What React left selected in the default-agent control. */
const picked = (c: FakeNode) => {
  const opts = find(select(c), (n) => n.localName === "option");
  const sel = opts.filter((o) => (o as unknown as { selected?: boolean }).selected || o.attrs.selected !== undefined);
  return sel.map((o) => o.attrs.value ?? o.textContent.trim());
};
/** MIRROR App.tsx:890-892. */
const newAgentOpens = (agents: AgentInfo[], defaultId: string) => (defaultId ? agents.find((x) => x.id === defaultId && x.installed) : agents.find((x) => x.installed));

test("box 1: switching off the default leaves no default on the page; a new session then asks, or takes the first agent available", async () => {
  h.settings = { defaultAgent: "codex" };
  h.agents = [CLAUDE, CODEX];
  const c = await page();
  expect(chips(c)).toEqual(["default"]);
  expect(row(c, "codex").textContent).toContain("default");
  (switchOf(c, "codex") as unknown as { checked: boolean }).checked = false; // the user's click turns the box off before React reads it
  await click(c, switchOf(c, "codex"));
  await until(() => h.patches.length > 0, "the switch to be saved");
  await settle(80);
  // Saved: codex off, and no default recorded.
  expect(h.settings.disabledAgents).toEqual(["codex"]);
  expect(h.settings.defaultAgent).toBe("");
  // The page: no "default" tag on any row, and the default control sits on Auto.
  expect(chips(c)).toEqual([]);
  expect(optionTexts(c)).toEqual(["Auto: the first agent available", "Claude Code"]);
  expect(picked(c)).toEqual([""]);
  expect(c.textContent).toContain("Switching the default agent off leaves no default.");
  // A new session: Codex is no longer offered, no default is set, and the first agent available is Claude.
  const offered = offeredAgents([CLAUDE, CODEX], h.settings);
  expect(offered.map((a) => a.id)).toEqual(["claude"]);
  expect(defaultAgentId(h.settings)).toBe("");
  expect(menuAgents(offered, defaultAgentId(h.settings)).map((a) => a.id)).toEqual(["claude"]);
  expect(newAgentOpens(offered, defaultAgentId(h.settings))?.id).toBe("claude");
  // With two on and no default the menu keeps catalogue order and the shortcut takes the first.
  const both = offeredAgents([CLAUDE, CODEX], {});
  expect(menuAgents(both, "").map((a) => a.id)).toEqual(["claude", "codex"]);
  expect(newAgentOpens(both, "")?.id).toBe("claude");
});

test("box 2: with every CLI gone, Refresh keeps the saved default listed and recorded; it is used again once one CLI is back", async () => {
  h.settings = { defaultAgent: "codex" };
  h.agents = [CLAUDE, CODEX];
  const c = await page();
  expect(picked(c)).toEqual(["codex"]);
  // Every CLI removed, then Refresh.
  h.agents = [agent("claude", "Claude Code", false), agent("codex", "Codex", false)];
  const before = h.lists;
  await click(c, refreshButton(c));
  await until(() => h.lists > before, "the second search");
  await settle(80);
  expect(c.textContent).toContain("No agent CLI was found. Install one, then press Refresh.");
  expect(refreshButton(c)).toBeTruthy();
  expect(h.settings.defaultAgent).toBe("codex"); // still recorded
  expect(h.patches.some((p) => "defaultAgent" in p.set || p.remove.includes("defaultAgent"))).toBe(false); // the search wrote nothing about it
  expect(optionTexts(c)).toEqual(["Auto: the first agent available", "Codex (saved, not found right now)"]);
  expect(picked(c)).toEqual(["saved:codex"]); // Auto is not the selected choice
  // Reinstalled: the page lists it as the default again, and the product's rules pick it for a new session.
  h.agents = [agent("claude", "Claude Code", false), CODEX];
  await click(c, refreshButton(c));
  await until(() => h.lists > before + 1, "the third search");
  await settle(80);
  expect(optionTexts(c)).toEqual(["Auto: the first agent available", "Codex"]);
  expect(picked(c)).toEqual(["codex"]);
  expect(chips(c)).toEqual(["default"]);
  const all = [agent("claude", "Claude Code", false), CODEX];
  const offered = offeredAgents(all, h.settings);
  expect(menuAgents(offered, defaultAgentId(h.settings)).map((a) => a.id)).toEqual(["codex"]);
  expect(newAgentOpens(offered, defaultAgentId(h.settings))?.id).toBe("codex");
  // And with the CLIs gone the saved default opens nothing (the notice says so) instead of silently falling back.
  expect(newAgentOpens(offeredAgents([agent("codex", "Codex", false)], h.settings), "codex")).toBeUndefined();
});
