// Audit F2: the Inbox detail reads the pane's prompt, history and source-control status. When row A is picked,
// then row B, an answer for A that lands after B's must never show under B.
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Root } from "react-dom/client";
import { click, find, installDom, type FakeDocument, type FakeNode } from "../test/fakeDom";
import InboxView from "./InboxView";
import type { Item } from "./inbox";

type Wait = { cmd: string; key: unknown; resolve: (v: unknown) => void };
const h = vi.hoisted(() => ({ waits: [] as Wait[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => new Promise((resolve) => h.waits.push({ cmd, key: args.paneKey ?? args.worktree, resolve })),
}));

let doc: FakeDocument;
let root: Root;
let container: FakeNode;
beforeEach(async () => {
  h.waits = [];
  doc = installDom().doc;
  Object.assign(doc, { getElementById: () => null }); // the list scrolls the picked row into view
  const { createRoot } = await import("react-dom/client");
  container = doc.createElement("div");
  doc.body.appendChild(container);
  root = createRoot(container as unknown as Element);
});
afterEach(() => act(() => root.unmount()));

const row = (key: number, cwd: string): Item => ({ key, agent: "claude", title: `Agent ${key}`, branch: null, cwd, state: "permission", group: "needs", label: "Permission", when: 1, exited: false });
const show = (items: Item[]) => act(async () => root.render(createElement(InboxView, { items, now: 2, onOpen: () => {} })));
const answer = (cmd: string, key: unknown, v: unknown) => act(async () => h.waits.find((w) => w.cmd === cmd && w.key === key)!.resolve(v));

test("a late answer for the row picked before never shows under the row picked now", async () => {
  await show([row(1, "C:/a"), row(2, "C:/b")]);
  const pick = (key: number) => click(container, find(container, (n) => n.attrs.id === `inbox-${key}`)[0]);
  await pick(1);
  await pick(2); // row 1's reads have not answered yet
  await answer("prompt_read", 1, { prompt: { kind: "permission", text: "Run rm for row one?", options: [] }, choices: [{ label: "Yes for one", keys: "1" }] });
  await answer("agent_history", 1, [{ state: "idle", prompt: "row one's prompt", started: 1, interrupted: false }]);
  await answer("scm_status", "C:/a", { branch: "row-one-branch", staged: [], changed: [1, 2, 3], untracked: [], conflicts: [] });
  const text = container.textContent;
  expect(text).toContain("Agent 2");
  expect(text).not.toContain("Yes for one");
  expect(text).not.toContain("row one's prompt");
  expect(text).not.toContain("row-one-branch");
});
