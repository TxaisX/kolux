// The Everyday New session (2026-11-24): one press opens a chat that runs through OpenCode in that plain
// folder, on the cheap default model, and the model and effort are changed inside the chat from then on.
// A kept chat opens again on the conversation and the pair it last used.
import { expect, test, vi } from "vitest";
import { readEverydayChats } from "../projects/everydayChats";
import { CHAT_AGENT, DEFAULT_CHAT_MODEL } from "../chat/opencode";

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
    activeDir: projects[0].path, agents: [mk("claude", "Claude Code"), mk("opencode", "OpenCode")], defaultId: "claude", focused: 0,
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
  await a.newChat("every", true, "opus", "claude");
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
  await a.newChat("every", true, "default", "claude");
  const pane = state.panes[0] as { chat?: boolean; chatModel?: string; args?: string[] };
  expect(pane.chat).toBe(true);
  expect(pane.chatModel).toBeUndefined();
  expect(pane.args).toEqual([]);
});

test("a new chat with nothing named runs through OpenCode on the cheap default model", async () => {
  const { a, state, settingsRef } = make();
  await a.newChat("every", true);
  const pane = state.panes[0] as { chat?: boolean; chatModel?: string; chatAgent?: string; agentId?: string; cwd?: string };
  expect(pane.cwd).toBe(projects[0].path);
  expect(pane.agentId).toBe("opencode");
  expect(pane.chatAgent).toBe("opencode");
  expect(pane.chat).toBe(true);
  expect(pane.chatModel).toBe("openrouter/deepseek/deepseek-v4.1-flash-1017");
  const chats = readEverydayChats(settingsRef.current);
  expect(chats[0]).toMatchObject({ agent: "opencode", model: "openrouter/deepseek/deepseek-v4.1-flash-1017" });
});

test("Everyday's New session names the same pair, with no menu to pick from", async () => {
  const { a, state } = make();
  await a.newChat("every", true, DEFAULT_CHAT_MODEL, CHAT_AGENT);
  const pane = state.panes[0] as { chatModel?: string; chatAgent?: string };
  expect(pane.chatAgent).toBe("opencode");
  expect(pane.chatModel).toBe(DEFAULT_CHAT_MODEL);
});

test("a chat never needs a worktree in a plain folder, and a second one is a second session", async () => {
  const { a, state } = make();
  await a.newChat("every", true, DEFAULT_CHAT_MODEL, CHAT_AGENT);
  await a.newChat("every", true, DEFAULT_CHAT_MODEL, CHAT_AGENT);
  expect(state.panes.map((p) => (p as { key: number }).key)).toEqual([1, 2]);
});

test("a chat kept from before OpenCode opens as a fresh OpenCode chat on the same model", async () => {
  const { a, state, settingsRef } = make();
  const rec = { id: "c-9", agent: "an-engine-that-is-gone", model: "anthropic/claude-sonnet-5.5", effort: "high", cwd: "C:\\E", session: "old-uuid", at: 5, name: "Taxes" };
  settingsRef.current = { everydayChats: [rec] };
  await a.openChat({ ...rec });
  const pane = state.panes[0] as { chat?: boolean; chatAgent?: string; agentId?: string; chatResume?: string; chatModel?: string; chatEffort?: string; title?: string };
  expect(pane.chat).toBe(true);
  expect(pane.agentId).toBe("opencode");
  expect(pane.chatAgent).toBe("opencode");
  expect(pane.chatModel).toBe("openrouter/anthropic/claude-sonnet-5.5");
  // The old program's conversation is not one OpenCode can open, so nothing is resumed.
  expect(pane.chatResume).toBeUndefined();
  expect(pane.title).toBe("Taxes");
  // The row is rewritten once, so the next open resumes what this chat goes on to say.
  expect((settingsRef.current.everydayChats as { agent: string; model?: string; session?: string }[])[0]).toMatchObject({ agent: "opencode", model: "openrouter/anthropic/claude-sonnet-5.5" });
  expect((settingsRef.current.everydayChats as { session?: string }[])[0].session).toBeUndefined();
});

test("a new chat is kept: the record holds its AI, model and folder, and the pane names it", async () => {
  const { a, state, settingsRef } = make();
  await a.newChat("every", true, "opus", "claude");
  const chats = readEverydayChats(settingsRef.current);
  expect(chats).toHaveLength(1);
  expect(chats[0]).toMatchObject({ agent: "claude", model: "opus", cwd: projects[0].path });
  expect((state.panes[0] as { everyday?: string }).everyday).toBe(chats[0].id);
});

test("a kept chat whose tab is gone opens again on its conversation, with its own AI, model and effort", async () => {
  const { a, state, settingsRef } = make();
  const rec = { id: "c-1", agent: "opencode", model: "openrouter/anthropic/claude-sonnet-5.5", effort: "high", cwd: "C:\\E", session: "s-7", at: 5, name: "Taxes" };
  settingsRef.current = { everydayChats: [rec] };
  await a.openChat({ ...rec });
  const pane = state.panes[0] as { chat?: boolean; chatResume?: string; chatModel?: string; chatEffort?: string; everyday?: string; title?: string };
  expect(pane.chat).toBe(true);
  expect(pane.chatResume).toBe("s-7");
  expect(pane.chatModel).toBe("openrouter/anthropic/claude-sonnet-5.5");
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
