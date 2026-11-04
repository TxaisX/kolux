import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import { AccountSwitcherView, EscapeWatch } from "./AccountSwitcher";
import { groupsOf } from "./accounts";
import { OPEN_SETTINGS } from "../settings/pages";

const claude = { accounts: [{ id: "c1", email: "work@example.com", organization: null, stale: false }], active: "c1", signingIn: null, keyMode: false, upkeepLeftToClaude: true };
const codex = { accounts: [{ id: "x1", email: "a@example.com", signInError: false }], active: null, signingIn: null, missing: [] };
const noop = () => {};
const view = (groups = groupsOf(claude, codex), open: { top: number; left: number } | null = null, error: string | null = null) => renderToString(createElement(AccountSwitcherView, { groups, open, error, onOpen: noop, onClose: noop, onPick: noop }));

test("C17-R5-01: with no managed account the top bar still draws its route to Accounts & keys", () => {
  const html = view([]);
  expect(html).not.toBe("");
  expect(html).toContain("Connect an AI");
  expect(html).not.toContain('aria-haspopup="menu"');
});

test("C17-R5-01: that route opens Settings at Accounts & keys, AI connections", () => {
  const target = new EventTarget();
  vi.stubGlobal("window", target);
  const seen: unknown[] = [];
  target.addEventListener(OPEN_SETTINGS, (e) => seen.push((e as CustomEvent).detail));
  const el = AccountSwitcherView({ groups: [], open: null, onOpen: noop, onClose: noop, onPick: noop }) as unknown as { props: { onClick: () => void } };
  el.props.onClick();
  expect(seen).toEqual([{ page: "accounts", section: "connections" }]);
  vi.unstubAllGlobals();
});

test("T-548: the top-bar pill names the account new Claude and Codex panes use, and the menu stays shut until clicked", () => {
  const html = view();
  expect(html).toContain("Claude work@example.com · Codex System default");
  expect(html).toContain('aria-haspopup="menu"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('role="menu"');
});

test("T-548: the open menu lists System default and each account per provider as radio items, the active one checked", () => {
  const html = view(undefined, { top: 40, left: 10 });
  expect(html).toContain('aria-label="Claude accounts"');
  expect(html).toContain('aria-label="Codex accounts"');
  expect(html.match(/role="menuitemradio"/g)?.length).toBe(4);
  expect(html.match(/aria-checked="true"/g)?.length).toBe(2);
  expect(html).toContain("Panes already running keep their account, until you accept the prompt to move one.");
  expect(html).not.toContain("disabled");
});

test("T-548: while a sign-in runs the provider's rows are disabled and Settings is named; a failed switch shows its words", () => {
  const html = view(groupsOf({ ...claude, signingIn: "c9" }, null), { top: 0, left: 0 }, "That Claude account is no longer listed.");
  expect(html.match(/disabled/g)?.length).toBe(2);
  expect(html).toContain("A sign-in is running. Finish or cancel it in Settings first.");
  expect(html).toContain('role="alert"');
  expect(html).toContain("That Claude account is no longer listed.");
});

test("T-548: the 1-year key note shows under the Claude rows", () => {
  expect(view(groupsOf({ ...claude, keyMode: true }, null), { top: 0, left: 0 })).toContain("1-year key");
});

// FIX-1 (council d2 stand-in review, AFTER 3 and 1): the view has no hooks of its own, so the tree it returns
// can be walked and a row's click handler called, which static HTML cannot do.
type Props = { role?: string; title?: string; onClick?: () => void; onClose?: () => void; children?: ReactNode };
const walk = (node: ReactNode, out: Array<ReactElement<Props>> = []): Array<ReactElement<Props>> => {
  Children.forEach(node, (child) => {
    if (!isValidElement<Props>(child)) return;
    out.push(child);
    walk(child.props.children, out);
  });
  return out;
};
const text = (node: ReactNode): string => {
  let s = "";
  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") s += child;
    else if (isValidElement<Props>(child)) s += text(child.props.children);
  });
  return s;
};
const tree = (groups = groupsOf({ ...claude, accounts: [...claude.accounts, { id: "c2", email: "me@example.com", organization: null, stale: false }] }, codex), open: { top: number; left: number } | null = { top: 0, left: 0 }, onPick: (p: string, id: string | null) => void = noop, onClose: () => void = noop) =>
  walk(AccountSwitcherView({ groups, open, error: null, onOpen: noop, onClose, onPick: onPick as never }));
const rowsOf = (els: Array<ReactElement<Props>>) => els.filter((e) => e.props.role === "menuitemradio");

test("FIX-1: clicking a row that is not in use asks onPick for that provider and id; clicking the one in use only closes the menu", () => {
  const onPick = vi.fn();
  const onClose = vi.fn();
  const rows = rowsOf(tree(undefined, { top: 0, left: 0 }, onPick, onClose));
  expect(rows.map((r) => text(r.props.children))).toEqual(["System default", "work@example.com✓", "me@example.com", "System default✓", "a@example.com"]);
  rows[2].props.onClick?.(); // Claude me@example.com
  expect(onPick).toHaveBeenLastCalledWith("claude", "c2");
  rows[0].props.onClick?.(); // Claude System default: null id
  expect(onPick).toHaveBeenLastCalledWith("claude", null);
  rows[4].props.onClick?.(); // Codex a@example.com
  expect(onPick).toHaveBeenLastCalledWith("codex", "x1");
  expect(onPick).toHaveBeenCalledTimes(3);
  expect(onClose).not.toHaveBeenCalled();
  rows[1].props.onClick?.(); // the account already in use
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onPick).toHaveBeenCalledTimes(3);
});

test("FIX-1: the open menu carries the Escape watcher even when every row is disabled, and the shut menu does not", () => {
  const onClose = vi.fn();
  const busy = groupsOf({ ...claude, signingIn: "c9" }, { ...codex, signingIn: "x9" });
  const els = tree(busy, { top: 0, left: 0 }, noop, onClose);
  expect(rowsOf(els).length).toBe(4);
  expect(html(busy).match(/disabled/g)?.length).toBe(4);
  const watch = els.filter((e) => e.type === EscapeWatch);
  expect(watch).toHaveLength(1);
  expect(watch[0].props.onClose).toBe(onClose);
  expect(tree(busy, null).filter((e) => e.type === EscapeWatch)).toHaveLength(0);
});
function html(groups: ReturnType<typeof groupsOf>) {
  return view(groups, { top: 0, left: 0 });
}
