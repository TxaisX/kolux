// OpenCode behind the chat page (2026-11-24): the model list, a folder's saved chats and their removal.
// Each test pins the command name and the arguments Tauri reads, and that a failure never reaches the page
// as an error it has to catch.
import { beforeEach, expect, test, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const fresh = async () => {
  vi.resetModules();
  return import("./opencode");
};

const rows = [
  { id: "openrouter/deepseek/deepseek-v4.1-flash-1017", label: "DeepSeek V4.1 Flash 1017", provider: "deepseek", efforts: ["none", "low", "high", "max"] },
  { id: "openrouter/anthropic/claude-opus-5.5", label: "Claude Opus 5.5", provider: "anthropic", efforts: ["low", "medium", "high", "xhigh", "max"] },
];

beforeEach(() => invoke.mockReset());

test("a chat runs through OpenCode, on the cheap DeepSeek model until another is picked", async () => {
  const m = await fresh();
  expect(m.CHAT_AGENT).toBe("opencode");
  expect(m.DEFAULT_CHAT_MODEL).toBe("openrouter/deepseek/deepseek-v4.1-flash-1017");
});

test("the model list is OpenCode's own, asked for once", async () => {
  const m = await fresh();
  invoke.mockResolvedValue(rows);
  expect(await m.listChatModels()).toEqual(rows);
  expect(await m.listChatModels()).toEqual(rows);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("chat_models");
});

test("two askers at once share one request", async () => {
  const m = await fresh();
  invoke.mockResolvedValue(rows);
  const [a, b] = await Promise.all([m.listChatModels(), m.listChatModels()]);
  expect(a).toEqual(rows);
  expect(b).toEqual(rows);
  expect(invoke).toHaveBeenCalledTimes(1);
});

test("a failed model list is an empty list and a warning, and the next ask tries again", async () => {
  const m = await fresh();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  invoke.mockRejectedValueOnce("OpenCode is not installed.");
  expect(await m.listChatModels()).toEqual([]);
  expect(warn).toHaveBeenCalledTimes(1);
  invoke.mockResolvedValueOnce(rows);
  expect(await m.listChatModels()).toEqual(rows);
  warn.mockRestore();
});

test("an empty answer is not kept, because OpenCode lists nothing in its first moments", async () => {
  const m = await fresh();
  invoke.mockResolvedValueOnce([]);
  expect(await m.listChatModels()).toEqual([]);
  invoke.mockResolvedValueOnce(rows);
  expect(await m.listChatModels()).toEqual(rows);
});

test("a row that is not a model is left out rather than drawn", async () => {
  const m = await fresh();
  invoke.mockResolvedValueOnce([rows[0], null, { id: 7 }, { id: "openrouter/x/y" }]);
  expect(await m.listChatModels()).toEqual([rows[0], { id: "openrouter/x/y", label: "openrouter/x/y", provider: "", efforts: [] }]);
});

test("an OpenRouter alias (~anthropic) is filed under its maker and named as the latest of it", async () => {
  const m = await fresh();
  invoke.mockResolvedValueOnce([{ id: "openrouter/~anthropic/claude-opus-latest", label: "Claude Opus Latest", provider: "~anthropic", efforts: [] }]);
  const [alias] = await m.listChatModels();
  expect(alias.provider).toBe("anthropic");
  expect(alias.label).toBe("Claude Opus (latest)");
  expect(alias.id).toBe("openrouter/~anthropic/claude-opus-latest");
});

test("a new server run (another process id) makes the next ask read the model list again", async () => {
  const m = await fresh();
  invoke.mockResolvedValue(rows);
  await m.listChatModels();
  m.noteServer(100);
  await m.listChatModels();
  expect(invoke).toHaveBeenCalledTimes(1);
  m.noteServer(100);
  m.noteServer(200);
  await m.listChatModels();
  expect(invoke).toHaveBeenCalledTimes(2);
});

test("a server restart tells everyone who shows the list, and a list read before it is not kept", async () => {
  const m = await fresh();
  const heard = vi.fn();
  m.onModelsStale(heard);
  m.noteServer(1);
  let release: (v: unknown) => void = () => {};
  invoke.mockReturnValueOnce(new Promise((r) => (release = r)));
  const slow = m.listChatModels();
  m.noteServer(2);
  expect(heard).toHaveBeenCalledTimes(1);
  release(rows);
  await slow;
  invoke.mockResolvedValueOnce([rows[1]]);
  expect(await m.listChatModels()).toEqual([rows[1]]);
});

test("a folder's saved chats come newest first", async () => {
  const m = await fresh();
  invoke.mockResolvedValueOnce([
    { id: "ses_a", title: "Older", updatedAt: 10 },
    { id: "ses_b", title: "Newer", updatedAt: 30 },
  ]);
  expect(await m.listChatSessions("C:/work/demo")).toEqual([
    { id: "ses_b", title: "Newer", updatedAt: 30 },
    { id: "ses_a", title: "Older", updatedAt: 10 },
  ]);
  expect(invoke).toHaveBeenCalledWith("chat_sessions", { cwd: "C:/work/demo" });
});

test("deleting a saved chat names its folder and its id", async () => {
  const m = await fresh();
  invoke.mockResolvedValueOnce(undefined);
  await m.deleteChatSession("C:/work/demo", "ses_b");
  expect(invoke).toHaveBeenCalledWith("chat_session_delete", { cwd: "C:/work/demo", session: "ses_b" });
});
