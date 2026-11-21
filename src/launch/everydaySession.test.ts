// The Everyday New session menu (2026-11-20): a picked model reaches the session it starts. A Claude pick
// marks the pane as the chat page and carries its model to the chat engine; every other AI opens its own
// session in the same plain folder with the model on its command line.
import { expect, test, vi } from "vitest";

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
  const settingsRef = { current: {} };
  const late = { projectOf: (cwd: string | null) => projects.find((p) => p.path === cwd)?.id ?? null };
  const a = launchActions(s as never, { settingsRef } as never, late as never);
  return { a, state, calls };
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
