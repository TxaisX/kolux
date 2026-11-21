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

test("starting a chat names the folder and asks for no model, no session and no extra variables", async () => {
  invoke.mockResolvedValueOnce(undefined);
  await startChat("pane-3", "C:/work/demo");
  expect(invoke).toHaveBeenLastCalledWith("chat_start", { chatId: "pane-3", cwd: "C:/work/demo", model: null, resumeSessionId: null, extraEnv: [], agent: "claude" });
});

test("a chat on OpenClaude names it, so the engine starts that program rather than Claude", async () => {
  invoke.mockResolvedValueOnce(undefined);
  await startChat("pane-4", "C:/work/demo", "deepseek/deepseek-v4.1-flash-1017", "openclaude");
  expect(invoke).toHaveBeenLastCalledWith("chat_start", { chatId: "pane-4", cwd: "C:/work/demo", model: "deepseek/deepseek-v4.1-flash-1017", resumeSessionId: null, extraEnv: [], agent: "openclaude" });
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
