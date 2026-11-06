// AUTO-005 acceptance, the window half. The real AutomationDialog and AutomationsPage functions run with
// their state kept by shallow-react.ts and the backend replaced by a recorder; the backend half (a doubled
// create leaves one automation, a created one is listed at once) is src-tauri/tests/cards_09.rs auto005_box1/box2.
// MIRROR AutomationsPage.tsx saved() -> load() -> automations_list; AutomationDialog.tsx save() / keys().
import { expect, test, vi } from "vitest";
import AutomationDialog from "../AutomationDialog";
import AutomationsPage, { type Data } from "../AutomationsPage";
import { everyString, find, findAll, mount, textOf, type El } from "../../settings/__cards__/shallow-react";

vi.mock("react", async (orig) => {
  const patched = (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>());
  const useMemo = <T>(f: () => T) => f();
  return { ...patched, useMemo, default: { ...(patched as { default: object }).default, useMemo } };
});
const h = vi.hoisted(() => ({ calls: [] as [string, any][], reply: {} as Record<string, unknown> }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: any) => {
    h.calls.push([cmd, args]);
    return cmd in h.reply ? Promise.resolve(h.reply[cmd]) : new Promise(() => {});
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} });

const projects = [{ id: "p1", name: "shop", path: "C:\src\shop", base: "main" }];
const trees = [{ path: "C:\src\shop", branch: "main", isMain: true }];
const settle = () => new Promise((r) => setTimeout(r, 5));
const saved = { id: "auto-1", name: "Morning checks", prompt: "look", provider: "claude", projectId: "p1", enabled: true, nextRunLabel: "Monday 09:00" };
const keyEvent = (key: string, ctrlKey = false) => ({ key, ctrlKey, metaKey: false, preventDefault() {}, stopPropagation() {} });
const dialog = (tree: El) => find(tree, (e) => e.type === "div" && e.props.role === "dialog");
const saveButton = (tree: El) => find(tree, (e) => e.type === "button" && textOf(e).startsWith("Sav"));
const callsOf = (cmd: string) => h.calls.filter(([c]) => c === cmd);

test("box 1: after Save the page asks for the list again and the new automation is in it, no refresh pressed", async () => {
  h.calls.length = 0;
  h.reply = { automations_list: { automations: [saved], runs: [] } };
  const empty: Data = { automations: [], runs: [] };
  const page = mount(AutomationsPage, { projects, agents: [], settings: {}, onSettings: () => {}, initial: { data: empty } } as never);
  let tree = page.render();
  expect(everyString(tree).join("|")).not.toContain("Morning checks");
  // New Automation opens the dialog, whose Save hands the saved automation to the page.
  findAll(tree, (e) => e.type === "button" && textOf(e).includes("New Automation"))[0].props.onClick();
  tree = page.render();
  const open = find(tree, (e) => e.type === AutomationDialog);
  open.props.onSaved(saved);
  await settle();
  expect(callsOf("automations_list").length).toBe(1);
  tree = page.render();
  const shown = everyString(tree).join("|");
  expect(shown).toContain("Morning checks");
  expect(shown).toContain("Saved Morning checks");
});

test("box 2: a second press of Save while the first is in flight sends nothing, and every send carries the same request id", () => {
  h.calls.length = 0;
  h.reply = {};
  const view = mount(AutomationDialog, { projects, agents: [], editing: null, onClose: () => {}, onSaved: () => {} } as never, { 15: trees, 5: "C:\src\shop", 1: "Morning checks", 2: "look" });
  let tree = view.render();
  expect(saveButton(tree).props.disabled).toBe(false);
  saveButton(tree).props.onClick();
  expect(callsOf("automation_save").length).toBe(1);
  // The window redraws with the save in flight: the button is off, and a press that still arrives does nothing.
  tree = view.render();
  expect(saveButton(tree).props.disabled).toBe(true);
  expect(textOf(saveButton(tree))).toBe("Saving…");
  saveButton(tree).props.onClick();
  expect(callsOf("automation_save").length).toBe(1);
  // Even a press that raced past the guard repeats the same request id, which the back end answers with the same automation.
  const first = callsOf("automation_save")[0][1].input.requestId;
  expect(first).toMatch(/^req-/);
  expect(view.render()).toBeTruthy();
  const again = mount(AutomationDialog, { projects, agents: [], editing: null, onClose: () => {}, onSaved: () => {} } as never, { 15: trees, 5: "C:\src\shop", 1: "Morning checks", 2: "look" });
  const t1 = again.render();
  saveButton(t1).props.onClick();
  saveButton(again.render()).props.onClick();
  const ids = callsOf("automation_save").slice(1).map(([, a]) => a.input.requestId);
  expect(new Set(ids).size).toBe(1);
});

test("box 3: Escape shuts the find bar and the dialog stays; a second Escape shuts the dialog", () => {
  let closed = 0;
  const view = mount(AutomationDialog, { projects, agents: [], editing: null, onClose: () => closed++, onSaved: () => {} } as never, { 15: trees, 5: "C:\src\shop" });
  let tree = view.render();
  expect(findAll(tree, (e) => e.props.role === "search").length).toBe(0);
  dialog(tree).props.onKeyDown(keyEvent("f", true));
  tree = view.render();
  expect(findAll(tree, (e) => e.props.role === "search").length).toBe(1);
  dialog(tree).props.onKeyDown(keyEvent("Escape"));
  tree = view.render();
  expect(findAll(tree, (e) => e.props.role === "search").length).toBe(0);
  expect(closed).toBe(0);
  expect(find(tree, (e) => e.props.role === "dialog")).toBeTruthy();
  dialog(tree).props.onKeyDown(keyEvent("Escape"));
  expect(closed).toBe(1);
});
