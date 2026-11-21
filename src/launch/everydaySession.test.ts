// The Everyday New session menu (2026-11-20): a picked model reaches the session it starts. A Claude pick
// marks the pane as the chat page and carries its model to the chat engine; every other AI opens its own
// session in the same plain folder with the model on its command line.
import { expect, test, vi } from "vitest";
import { readEverydayChats } from "../projects/everydayChats";

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
    activeDir: projects[0].path, agents: [mk("claude", "Claude Code"), mk("codex", "Codex")], defaultId: "claude", focused: 0,
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

test("another AI opens its own session in the same folder on the picked model", async () => {
  const { a, state } = make();
  await a.newSession("every", "codex", "gpt-5");
  const pane = state.panes[0] as { chat?: boolean; agentId?: string; cwd?: string; args?: string[] };
  expect(pane.cwd).toBe(projects[0].path);
  expect(pane.agentId).toBe("codex");
  expect(pane.chat).toBeUndefined();
  expect(pane.args).toEqual(["--model", "gpt-5"]);
});

test("another AI's Program default adds no model flag", async () => {
  const { a, state } = make();
  await a.newSession("every", "codex", "default");
  const pane = state.panes[0] as { args?: string[] };
  expect(pane.args).toEqual([]);
});

test("a chat never needs a worktree in a plain folder, and a second one is a second session", async () => {
  const { a, state } = make();
  await a.newChat("every", true, "sonnet");
  await a.newChat("every", true, "haiku");
  expect(state.panes.map((p) => (p as { key: number }).key)).toEqual([1, 2]);
  expect(state.panes.map((p) => (p as { chatModel?: string }).chatModel)).toEqual(["sonnet", "haiku"]);
});

test("a new chat is kept: the record holds its AI, model and folder, and the pane names it", async () => {
  const { a, state, settingsRef } = make();
  await a.newChat("every", true, "opus");
  const chats = readEverydayChats(settingsRef.current);
  expect(chats).toHaveLength(1);
  expect(chats[0]).toMatchObject({ agent: "claude", model: "opus", cwd: projects[0].path });
  expect((state.panes[0] as { everyday?: string }).everyday).toBe(chats[0].id);
});

test("a kept chat whose tab is gone opens again with --resume, on its own AI and model", async () => {
  const { a, state, settingsRef } = make();
  const rec = { id: "c-1", agent: "claude", model: "sonnet", cwd: "C:\\E", session: "s-7", at: 5, name: "Taxes" };
  settingsRef.current = { everydayChats: [rec] };
  await a.openChat({ ...rec });
  const pane = state.panes[0] as { chat?: boolean; chatResume?: string; chatModel?: string; everyday?: string; title?: string; args?: string[] };
  expect(pane.chat).toBe(true);
  expect(pane.chatResume).toBe("s-7");
  expect(pane.chatModel).toBe("sonnet");
  expect(pane.everyday).toBe("c-1");
  expect(pane.title).toBe("Taxes");
  expect(pane.args).toEqual(["--model", "sonnet"]);
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
