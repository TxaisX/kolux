// VIEW-021 acceptance: the real AgentsRail's + button, railGroups and pickSession.
// MIRROR src/App.tsx:2290-2296 addPreset (pane with seats:[{agent:id}], setAgentSel(key)); the grouping and the pick are railGroups / pickSession.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import AgentsRail from "../AgentsRail";
import { pickSession, railGroups, rowStatus } from "../rail";

const saved = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
];
const props = (groups: unknown, selected: number | null, over: Record<string, unknown> = {}) => ({ groups: groups as never, selected, classic: false, statusOf: ((p: { seats?: { agent: string | null }[] }) => rowStatus(p, null)) as never, ringOf: () => null, footer: "", onSelect: () => {}, onAdd: () => {}, onSettings: () => {}, ...over });

function walk(el: unknown, hit: (e: ReactElement<Record<string, unknown>>) => boolean, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(el)) el.forEach((c) => walk(c, hit, out));
  else if (el && typeof el === "object" && "props" in el) {
    const e = el as ReactElement<Record<string, unknown>>;
    if (hit(e)) out.push(e);
    walk(e.props.children, hit, out);
  }
  return out;
}

test("box 1: + under an agent adds a not-started row under that agent and selects it; an agent with no session has no group or +", () => {
  type P = { key: number; cwd: string | null; agent: string; agentId?: string; program: string | null; seats?: { agent: string | null }[] };
  let panes: P[] = [{ key: 1, cwd: "C:/w/app", agent: "claude", agentId: "claude", program: "claude" }];
  let agentSel: number | null = pickSession(railGroups(panes, saved), null);
  expect(agentSel).toBe(1);
  // The + buttons are the rail's own: one per group that has a session, none for an idle agent or Other sessions.
  const groups = railGroups(panes, saved);
  const rail = AgentsRail(props(groups, agentSel, { onAdd: (id: string) => {
    const key = 2; // App's addPreset
    panes = [...panes, { key, cwd: "C:/w/app", agent: "shell", agentId: id, program: null, seats: [{ agent: id }] }];
    agentSel = key;
  } }) as never) as ReactElement;
  const plus = walk(rail, (e) => e.props["aria-label"] === "Add a Claude Code session");
  expect(plus).toHaveLength(1);
  expect(walk(rail, (e) => e.props["aria-label"] === "Add a Codex session")).toHaveLength(0);
  (plus[0].props.onClick as () => void)();
  const after = railGroups(panes, saved);
  expect(after.map((g) => [g.id, g.sessions.map((p) => p.key)])).toEqual([["claude", [1, 2]]]);
  expect(pickSession(after, agentSel)).toBe(2);
  const html = renderToStaticMarkup(createElement(AgentsRail, props(after, pickSession(after, agentSel))));
  expect(html).toMatch(/class="sess sel pending"[^>]*data-session="2"/);
  expect(html).toContain("New session");
  expect(html).toContain(">Not started<");
});

test("box 2: a fresh profile with no saved agents shows an empty state, not a blank rail", () => {
  const groups = railGroups([], []);
  expect(groups).toEqual([]);
  let opened = 0;
  const html = renderToStaticMarkup(createElement(AgentsRail, props(groups, null, { onSettings: () => opened++ })));
  expect(html).toContain("No agents yet");
  expect(html).toContain("Open Settings");
  expect(html).not.toContain("rail-group");
  const rail = AgentsRail(props(groups, null, { onSettings: () => opened++ }) as never) as ReactElement;
  const btn = walk(rail, (e) => e.type === "button")[0];
  (btn.props.onClick as () => void)();
  expect(opened).toBe(1);
});

test("box 3: saved agents with no open session leave the rail empty and offer New session", () => {
  const groups = railGroups([], [{ id: "claude", name: "Claude Code" }]);
  expect(groups).toEqual([]);
  let started = 0;
  const html = renderToStaticMarkup(createElement(AgentsRail, props(groups, null, { hasAgents: true, onNew: () => started++ })));
  expect(html).toContain("No sessions yet");
  expect(html).toContain("New session");
  expect(html).not.toContain("Claude Code");
  expect(html).not.toContain("rail-group");
  const rail = AgentsRail(props(groups, null, { hasAgents: true, onNew: () => started++ }) as never) as ReactElement;
  const btn = walk(rail, (e) => e.type === "button")[0];
  (btn.props.onClick as () => void)();
  expect(started).toBe(1);
});
