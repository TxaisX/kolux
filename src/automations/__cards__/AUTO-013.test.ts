// AUTO-013 acceptance, the window half. The real AutomationsPage and its Runs-tab Detail run with their state kept
// by shallow-react.ts and the backend replaced by a recorder; the backend half (a gone worktree's run still lists its
// saved output, an unreadable history says so, deleting an automation takes its runs) is src-tauri/tests/cards_09.rs auto013_*.
// MIRROR AutomationsPage.tsx:195 act(delete) -> load(); the page draws whatever automations_list returns.
import { expect, test, vi } from "vitest";
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
const settle = () => new Promise((r) => setTimeout(r, 5));
const auto = { id: "auto-1", name: "Nightly checks", prompt: "audit", provider: "claude", projectId: "p1", enabled: true };
const props = (data: Data) => ({ projects, agents: [], settings: {}, onSettings: () => {}, initial: { data, open: "auto-1" } }) as never;
const runsTab = (tree: El) => {
  const d = find(tree, (e) => typeof e.type === "function" && (e.type as { name: string }).name === "Detail");
  return mount(d.type as never, { ...d.props, tab: "runs" } as never);
};
const buttons = (tree: unknown) => findAll(tree, (e) => e.type === "button").map(textOf);

test("box 1: a run whose worktree is gone offers its saved output, and opening it shows the output with a note that it is a snapshot", () => {
  const data: Data = { automations: [auto as never], runs: [{ id: "run-1", automationId: "auto-1", number: 1, trigger: "schedule", status: "completed", at: Date.now(), worktree: "C:\gone\nightly-1", worktreeName: "nightly-1", worktreeGone: true, output: "all 12 checks passed" } as never] };
  const detail = runsTab(mount(AutomationsPage, props(data)).render());
  let tree = detail.render();
  expect(buttons(tree)).toContain("Saved output");
  expect(buttons(tree)).not.toContain("View run");
  expect(everyString(tree).join("|")).not.toContain("A snapshot:");
  findAll(tree, (e) => e.type === "button" && textOf(e) === "Saved output")[0].props.onClick();
  tree = detail.render();
  const shown = findAll(tree, (e) => e.props?.className === "autos-snapshot").map(textOf).join("");
  expect(shown).toContain("A snapshot: the workspace nightly-1 is gone");
  expect(shown).toContain("not a live terminal");
  expect(shown).toContain("all 12 checks passed");
});

test("box 2: a failed run shows Rerun; once the automation is deleted the page lists neither it nor its runs", () => {
  const failed = { id: "run-1", automationId: "auto-1", number: 1, trigger: "manual", status: "failed", at: Date.now(), detail: "claude did not start" } as never;
  const before = runsTab(mount(AutomationsPage, props({ automations: [auto as never], runs: [failed] })).render()).render();
  expect(buttons(before)).toContain("Rerun");
  // automations_list after automation_delete: the automation and its run history are both gone.
  const after = mount(AutomationsPage, props({ automations: [], runs: [] })).render();
  expect(buttons(after).filter((t) => t.startsWith("Rerun"))).toEqual([]);
  expect(everyString(after).join("|")).not.toContain("Rerun");
});

test("box 3: history that cannot be read shows an error with Try again, never an empty list, and Try again asks the back end for the list", async () => {
  h.calls.length = 0;
  const broken: Data = { automations: [auto as never], runs: [], runsError: "the saved runs could not be read" };
  h.reply = { automations_list: { automations: [auto], runs: [{ id: "run-1", automationId: "auto-1", number: 1, trigger: "manual", status: "completed", at: Date.now() }] } };
  const page = mount(AutomationsPage, props(broken));
  const d = find(page.render(), (e) => typeof e.type === "function" && (e.type as { name: string }).name === "Detail");
  // Try again is the page's own reload: it asks the back end for the list and the history comes back.
  d.props.onRetry();
  await settle();
  expect(h.calls.filter(([c]) => c === "automations_list").length).toBe(1);
  const d2 = find(page.render(), (e) => typeof e.type === "function" && (e.type as { name: string }).name === "Detail");
  expect(d2.props.runsError).toBeUndefined();
  expect(d2.props.runs.length).toBe(1);
  // The broken state itself: an error with the recovery action, not an empty list (mounting the Detail replaces the shared state slots, so it comes last).
  const tree = mount(d.type as never, { ...d.props, tab: "runs" } as never).render();
  const alert = find(tree, (e) => e.props?.role === "alert");
  expect(textOf(alert)).toContain("The run history could not be read: the saved runs could not be read");
  expect(everyString(tree).join("|")).not.toContain("No runs yet");
  expect(findAll(alert, (e) => e.type === "button").map(textOf)).toEqual(["Try again"]);
  expect(find(alert, (e) => e.type === "button").props.onClick).toBe(d.props.onRetry);
});
