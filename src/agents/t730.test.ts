// T-730 / DT-C166: a not-started preset on the Agents rail can be removed again, and the right-sidebar tab
// that lists past sessions is "History", not "Agents" (the Agents screen's name).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { RIGHT_TABS, splitTabs } from "../chrome/RightSidebar";
import AgentsRail from "./AgentsRail";
import { railGroups, rowStatus } from "./rail";

const saved = [{ id: "claude", name: "Claude Code" }];
const panes = [
  { key: 1, cwd: "C:/w/app", agent: "claude", agentId: "claude", program: "claude" },
  { key: 2, cwd: "C:/w/app", agent: "shell", agentId: "claude", program: null, seats: [{ agent: "claude" }] },
];
const props = (over: Record<string, unknown> = {}) => ({ groups: railGroups(panes, saved) as never, selected: 2, classic: false, statusOf: ((p: { seats?: unknown[] }) => rowStatus(p as never, null)) as never, ringOf: () => null, footer: "", onSelect: () => {}, onAdd: () => {}, onSettings: () => {}, ...over });

function walk(el: unknown, hit: (e: ReactElement<Record<string, unknown>>) => boolean, out: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(el)) el.forEach((c) => walk(c, hit, out));
  else if (el && typeof el === "object" && "props" in el) {
    const e = el as ReactElement<Record<string, unknown>>;
    if (hit(e)) out.push(e);
    walk(e.props.children, hit, out);
  }
  return out;
}

test("only the not-started preset has Remove, beside its row (not inside the row's button), and it drops that pane", () => {
  const dropped: number[] = [];
  const rail = AgentsRail(props({ onDrop: (k: number) => dropped.push(k) }) as never) as ReactElement;
  const remove = walk(rail, (e) => e.type === "button" && e.props.children === "Remove");
  expect(remove).toHaveLength(1);
  (remove[0].props.onClick as () => void)();
  expect(dropped).toEqual([2]);
  const html = renderToStaticMarkup(createElement(AgentsRail, props()));
  // the row is a role=button div; Remove comes right after it closes, so no button sits in a button
  expect(html).toMatch(/class="sess sel pending"[^>]*data-session="2"[^>]*>(?:(?!<button).)*?<\/div><button>Remove<\/button>/);
  expect(html.match(/>Remove</g)).toHaveLength(1);
});

test("the right-sidebar tab for past sessions is called History and fits the strip at the default width", () => {
  const tab = RIGHT_TABS.find((t) => t.id === "agents");
  expect(tab?.label).toBe("History");
  expect(RIGHT_TABS.some((t) => t.label === "Agents")).toBe(false);
  // a plain workspace offers Explorer, Insights, Checks and this tab; at 300 px none goes into More
  const plain = RIGHT_TABS.filter((t) => ["explorer", "insights", "checks", "agents"].includes(t.id));
  expect(splitTabs(plain, "explorer", 300).more).toEqual([]);
});
