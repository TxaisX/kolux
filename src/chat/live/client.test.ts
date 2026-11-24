// Slice 1 of chat panes: the page's side of the engine's contract (docs/chat-engine.md). Each test pins the
// command name and the arguments Tauri reads, so a mistake here is caught before a hidden `claude` is asked
// for anything, and the event filter is proved to keep one pane's lines out of another's.
import { expect, test, vi } from "vitest";

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import { CHAT_EVENT, chatIdOf, endChat, hearChat, sendChat, startChat, stopChat } from "./client";
import type { ChatEvent } from "./events";

test("a chat's id is its pane's key, so two panes never share a process", () => {
  expect(chatIdOf(3)).toBe("pane-3");
});

test("starting a chat names the folder and asks for no model, effort, session or extra variables", async () => {
  invoke.mockResolvedValueOnce(undefined);
  await startChat("pane-3", "C:/work/demo");
  expect(invoke).toHaveBeenLastCalledWith("chat_start", { chatId: "pane-3", cwd: "C:/work/demo", model: null, effort: null, resumeSessionId: null, extraEnv: [], agent: "claude" });
});

test("a chat on OpenCode names it, so the engine asks OpenCode rather than starting Claude", async () => {
  invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === "chat_models" ? [] : undefined));
  await startChat("pane-4", "C:/work/demo", "openrouter/deepseek/deepseek-v4.1-flash-1017", "opencode");
  expect(invoke).toHaveBeenCalledWith("chat_start", { chatId: "pane-4", cwd: "C:/work/demo", model: "openrouter/deepseek/deepseek-v4.1-flash-1017", effort: null, resumeSessionId: null, extraEnv: [], agent: "opencode" });
  invoke.mockReset();
});

test("another model or effort on the same conversation carries all three", async () => {
  invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === "chat_models" ? [] : undefined));
  await startChat("pane-5", "C:/work/demo", "openrouter/openai/gpt-5.5", "opencode", "ses_42", "high");
  expect(invoke).toHaveBeenCalledWith("chat_start", { chatId: "pane-5", cwd: "C:/work/demo", model: "openrouter/openai/gpt-5.5", effort: "high", resumeSessionId: "ses_42", extraEnv: [], agent: "opencode" });
  invoke.mockReset();
});

test("opening an OpenCode chat fetches its model list for the controls, and a Claude chat does not", async () => {
  const { choicesFor, setChatModels } = await import("../controls");
  const row = { id: "openrouter/x/fresh-for-this-test", label: "Fresh", provider: "x", efforts: ["low"] };
  invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === "chat_models" ? [row] : undefined));
  await startChat("pane-6", "C:/work/demo");
  expect(invoke).not.toHaveBeenCalledWith("chat_models");
  await startChat("pane-6", "C:/work/demo", null, "opencode");
  await vi.waitFor(() => expect(choicesFor("opencode").map((m) => m.id)).toEqual([row.id]));
  setChatModels([]);
  invoke.mockReset();
});

test("a pane kept by an older build names an engine that is gone: it opens on OpenCode as a fresh conversation", async () => {
  invoke.mockImplementation((cmd: string) => Promise.resolve(cmd === "chat_models" ? [] : undefined));
  await startChat("pane-7", "C:/work/demo", "anthropic/claude-sonnet-5.5", "an-engine-that-is-gone", "0b1c-old-conversation", "high");
  expect(invoke).toHaveBeenCalledWith("chat_start", { chatId: "pane-7", cwd: "C:/work/demo", model: "openrouter/anthropic/claude-sonnet-5.5", effort: "high", resumeSessionId: null, extraEnv: [], agent: "opencode" });
  invoke.mockReset();
});

test("a message goes as text; attachments are already paths in it, so no image is sent", async () => {
  invoke.mockResolvedValueOnce(undefined);
  await sendChat("pane-3", "read this\nC:/work/demo/notes.md");
  expect(invoke).toHaveBeenLastCalledWith("chat_send", { chatId: "pane-3", text: "read this\nC:/work/demo/notes.md", images: [] });
});

test("a stop gives back how the turn ended, and null when no turn was running", async () => {
  invoke.mockResolvedValueOnce("interrupt");
  expect(await stopChat("pane-3")).toBe("interrupt");
  invoke.mockResolvedValueOnce(null);
  expect(await stopChat("pane-3")).toBeNull();
  // A backend that answers nothing is a stop that did nothing, never an error the pane has to explain.
  invoke.mockResolvedValueOnce(undefined);
  expect(await stopChat("pane-3")).toBeNull();
  expect(invoke).toHaveBeenLastCalledWith("chat_stop", { chatId: "pane-3" });
});

test("ending a chat goes to chat_end", async () => {
  invoke.mockResolvedValueOnce(undefined);
  await endChat("pane-3");
  expect(invoke).toHaveBeenLastCalledWith("chat_end", { chatId: "pane-3" });
});

test("one pane hears only its own chat's events, and can stop hearing them", async () => {
  const off = vi.fn();
  listen.mockResolvedValueOnce(off);
  const heard: ChatEvent[] = [];
  const stop = await hearChat("pane-3", (ev) => heard.push(ev));
  expect(listen).toHaveBeenLastCalledWith(CHAT_EVENT, expect.any(Function));
  const handler = listen.mock.calls[listen.mock.calls.length - 1][1] as (e: { payload: unknown }) => void;
  handler({ payload: { chatId: "pane-4", kind: "assistant", blocks: [{ type: "text", text: "another pane's words" }] } });
  handler({ payload: undefined });
  expect(heard).toEqual([]);
  const mine: ChatEvent = { chatId: "pane-3", kind: "assistant", blocks: [{ type: "text", text: "mine" }] };
  handler({ payload: mine });
  expect(heard).toEqual([mine]);
  // The listener's own answer is the way to stop: nothing of this pane's stays subscribed.
  expect(stop).toBe(off);
  stop();
  expect(off).toHaveBeenCalledTimes(1);
});
