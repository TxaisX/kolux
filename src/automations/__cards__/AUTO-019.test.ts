// AUTO-019 acceptance, the window half. The real AutomationsPage runs with its state kept by shallow-react.ts and the
// backend replaced by a recorder; the backend half (a manual run of a paused automation lands in history, a paused
// automation does not run at its due time) is src-tauri/tests/cards_09.rs auto019_box1 and box3.
import { expect, test, vi } from "vitest";
import AutomationsPage, { type Data } from "../AutomationsPage";
import { find, findAll, mount, textOf, type El } from "../../settings/__cards__/shallow-react";

vi.mock("react", async (orig) => {
  const patched = (await import("../../settings/__cards__/shallow-react")).patchReact(await orig<object>());
  const useMemo = <T>(f: () => T) => f();
  return { ...patched, useMemo, default: { ...(patched as { default: object }).default, useMemo } };
});
const h = vi.hoisted(() => ({ calls: [] as [string, any][] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: any) => {
    h.calls.push([cmd, args]);
    return new Promise(() => {});
  },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}), emit: () => Promise.resolve() }));
vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} });

const projects = [{ id: "p1", name: "shop", path: "C:\\src\\shop", base: "main" }];
const paused = { id: "auto-1", name: "Nightly checks", prompt: "audit", provider: "claude", projectId: "p1", enabled: false, trigger: { kind: "schedule", cron: "0 2 * * *", timezone: "UTC" } } as never;
const mountPage = (settings: Record<string, unknown>, automation: object = paused as object, onSettings = (_: Record<string, unknown>) => {}) => {
  const data: Data = { automations: [automation as never], runs: [] };
  return mount(AutomationsPage, { projects, agents: [], settings, onSettings, initial: { data } } as never);
};
type Page = ReturnType<typeof mountPage>;
const callsOf = (cmd: string) => h.calls.filter(([c]) => c === cmd);
// The row menu is a src/ui Menu: a row is a MenuItem, found by its text, with the onClick it was given.
const menuItem = (tree: El, label: string) => find(tree, (e) => typeof e.props?.onClick === "function" && e.props?.title !== "Quick actions" && textOf(e) === label);
const openMenu = (p: Page) => {
  find(p.render(), (e) => e.type === "button" && e.props.title === "Quick actions").props.onClick({ stopPropagation() {} });
  return p.render();
};
const choose = (p: Page, label: string) => menuItem(openMenu(p), label).props.onClick();

test("box 1: Run Now in a paused automation's quick-actions menu asks the back end to run it by hand and says it is queued", () => {
  h.calls.length = 0;
  const p = mountPage({});
  const tree = openMenu(p);
  expect(textOf(menuItem(tree, "Resume"))).toBe("Resume"); // it is paused
  const runNow = menuItem(tree, "Run now");
  expect(runNow.props.disabled).toBe(false);
  runNow.props.onClick();
  expect(callsOf("automation_run_now")).toEqual([["automation_run_now", { id: "auto-1" }]]);
  expect(textOf(find(p.render(), (e) => e.props?.role === "status"))).toBe("Run now: Nightly checks is queued");
});

test("box 2: with the confirmation on (the default) Delete asks first; with it switched off the next Delete happens at once", () => {
  h.calls.length = 0;
  const saved: Record<string, unknown>[] = [];
  const on = mountPage({}, paused as object, (s) => saved.push(s));
  choose(on, "Delete");
  expect(callsOf("automation_delete")).toEqual([]);
  const ask = find(on.render(), (e) => typeof e.props?.title === "string" && e.props.title.startsWith("Delete Nightly checks?"));
  expect(ask.props.body).toBe("Its run history goes with it.");
  // Confirming with the do-not-ask-again tick deletes and switches the question off.
  ask.props.onConfirm(true);
  expect(callsOf("automation_delete")).toEqual([["automation_delete", { id: "auto-1" }]]);
  expect(saved).toEqual([{ confirmAutomationDelete: false }]);

  h.calls.length = 0;
  const off = mountPage(saved[0]);
  choose(off, "Delete");
  expect(callsOf("automation_delete")).toEqual([["automation_delete", { id: "auto-1" }]]);
  expect(findAll(off.render(), (e) => typeof e.props?.title === "string" && e.props.title.startsWith("Delete ")).length).toBe(0);
});

test("box 3 (window half): the menu's Pause asks the back end to switch the automation off", () => {
  h.calls.length = 0;
  choose(mountPage({}, { ...(paused as object), enabled: true }), "Pause");
  expect(callsOf("automation_set_enabled")).toEqual([["automation_set_enabled", { id: "auto-1", enabled: false }]]);
});
