// The Everyday New session (2026-11-21): one press opens OpenClaude's chat page in that plain folder, on
// OpenClaude's cheap default, and the model and effort are changed inside the chat from then on. A kept
// chat opens again with `--resume` on the pair it last used.
import { expect, test, vi } from "vitest";
import { readEverydayChats } from "../projects/everydayChats";
import { OPENCLAUDE_DEFAULT } from "./seats";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: { id?: string; extra?: string[] }) =>
    cmd === "agent_start_line"
      ? Promise.resolve({ args: args.extra ?? [], typed: null, program: args.id ?? "stub", env: [] })
      : Promise.resolve(null),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));

const { launchActions } = await import("./launchActions");

const mk = (id: string, name: string) => ({ id, name, program: id, args: [], installed: true, path: `C:\\bin\\${id}.exe` });

const projects = [{ id: "every", name: "Everyday", path: "C:\\Users\\X\\Kolux\\Everyday" }];

function make() {
  const state: { panes: unknown[] } = { panes: [] };
  const setPanes = vi.fn((v: unknown) => {
    state.panes = typeof v === "function" ? (v as (p: unknown[]) => unknown[])(state.panes) : (v as unknown[]);
  });
  const calls = { setNotice: vi.fn(), setRefresh: vi.fn(), setLaunching: vi.fn(), setFocused: vi.fn(), setActiveDir: vi.fn() };
  const s = {
    activeDir: projects[0].path, agents: [mk("claude", "Claude Code"), mk("openclaude", "OpenClaude")], defaultId: "claude", focused: 0,
    nextKey: { current: 1 }, panes: [], projects, settings: {}, setPanes, ...calls,
  };
  const settingsRef: { current: Record<string, unknown> } = { current: {} };
  // The window's own save: it runs a value function over the key's latest value, as useSettingsPlumbing does.
  const saveSetting = vi.fn((key: string, value: unknown) => {
    const v = typeof value === "function" ? (value as (prev: unknown) => unknown)(settingsRef.current[key]) : value;
    if (v !== undefined) settingsRef.current = { ...settingsRef.current, [key]: v };
  });
  const late = { projectOf: (cwd: string | null) => projects.find((p) => p.path === cwd)?.id ?? null };
  const a = launchActions(s as never, { settingsRef, saveSetting } as never, late as never);
  return { a, state, calls, settingsRef };
}

test("a Claude pick opens the chat page on that model", async () => {
  const { a, state } = make();
  await a.newChat("every", true, "opus");
  const pane = state.panes[0] as { chat?: boolean; chatModel?: string; agentId?: string; cwd?: string; args?: string[] };
  expect(pane.cwd).toBe(projects[0].path);
  expect(pane.agentId).toBe("claude");
  expect(pane.chat).toBe(true);
  expect(pane.chatModel).toBe("opus");
  // The start line carries it too, so a restored terminal would agree with the chat.
  expect(pane.args).toEqual(["--model", "opus"]);
});

test("the program's own default adds no model, and marks no chat model", async () => {
  const { a, state } = make();
  await a.newChat("every", true, "default");
  const pane = state.panes[0] as { chat?: boolean; chatModel?: string; args?: string[] };
  expect(pane.chat).toBe(true);
  expect(pane.chatModel).toBeUndefined();
  expect(pane.args).toEqual([]);
});

test("Everyday's New session opens OpenClaude on its cheap default, with no menu to pick from", async () => {
  const { a, state, settingsRef } = make();
  await a.newChat("every", true, OPENCLAUDE_DEFAULT, "openclaude");
  const pane = state.panes[0] as { chat?: boolean; chatModel?: string; chatAgent?: string; agentId?: string; cwd?: string };
  expect(pane.cwd).toBe(projects[0].path);
  expect(pane.agentId).toBe("openclaude");
  expect(pane.chatAgent).toBe("openclaude");
  expect(pane.chat).toBe(true);
  expect(pane.chatModel).toBe(OPENCLAUDE_DEFAULT);
  const chats = readEverydayChats(settingsRef.current);
  expect(chats[0]).toMatchObject({ agent: "openclaude", model: OPENCLAUDE_DEFAULT });
});

test("a chat never needs a worktree in a plain folder, and a second one is a second session", async () => {
  const { a, state } = make();
  await a.newChat("every", true, OPENCLAUDE_DEFAULT, "openclaude");
  await a.newChat("every", true, OPENCLAUDE_DEFAULT, "openclaude");
  expect(state.panes.map((p) => (p as { key: number }).key)).toEqual([1, 2]);
});

test("a new chat is kept: the record holds its AI, model and folder, and the pane names it", async () => {
  const { a, state, settingsRef } = make();
  await a.newChat("every", true, "opus");
  const chats = readEverydayChats(settingsRef.current);
  expect(chats).toHaveLength(1);
  expect(chats[0]).toMatchObject({ agent: "claude", model: "opus", cwd: projects[0].path });
  expect((state.panes[0] as { everyday?: string }).everyday).toBe(chats[0].id);
});

test("a kept chat whose tab is gone opens again with --resume, on its own AI, model and effort", async () => {
  const { a, state, settingsRef } = make();
  const rec = { id: "c-1", agent: "openclaude", model: "anthropic/claude-sonnet-5.5", effort: "high", cwd: "C:\\E", session: "s-7", at: 5, name: "Taxes" };
  settingsRef.current = { everydayChats: [rec] };
  await a.openChat({ ...rec });
  const pane = state.panes[0] as { chat?: boolean; chatResume?: string; chatModel?: string; chatEffort?: string; everyday?: string; title?: string };
  expect(pane.chat).toBe(true);
  expect(pane.chatResume).toBe("s-7");
  expect(pane.chatModel).toBe("anthropic/claude-sonnet-5.5");
  expect(pane.chatEffort).toBe("high");
  expect(pane.everyday).toBe("c-1");
  expect(pane.title).toBe("Taxes");
  // Opened just now, so its row moves to the top for the next look at the list.
  expect((settingsRef.current.everydayChats as { at: number }[])[0].at).toBeGreaterThan(5);
});

test("a chat with no conversation id yet still opens, as a fresh conversation", async () => {
  const { a, state } = make();
  await a.openChat({ id: "c-2", agent: "claude", cwd: "C:\\E", at: 5 });
  const pane = state.panes[0] as { chat?: boolean; chatResume?: string; chatModel?: string };
  expect(pane.chat).toBe(true);
  expect(pane.chatResume).toBeUndefined();
  expect(pane.chatModel).toBeUndefined();
});
