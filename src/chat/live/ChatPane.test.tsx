// The chat pane as a whole (review 2026-11-24, findings 3, 7, 8, 10, 15 and the live-run bugs A and B): mounted in
// the fake page with the engine's commands scripted, so what the reader sees and what the engine is asked can be
// checked together. The engine itself (Rust) is not here; only the page's side of it.
import { createElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { click, find, installDom, mount, settle, until, type FakeDocument, type FakeNode } from "../../test/fakeDom";

type Call = { cmd: string; args: Record<string, unknown> };
const h = vi.hoisted(() => ({
  calls: [] as Array<{ cmd: string; args: Record<string, unknown> }>,
  script: (_cmd: string, _args: Record<string, unknown>): unknown => undefined,
  hear: null as null | ((e: { payload: unknown }) => void),
  groups: 0,
  sections: 0,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: Record<string, unknown> = {}) => {
    h.calls.push({ cmd, args });
    try {
      return Promise.resolve(h.script(cmd, args));
    } catch (e) {
      return Promise.reject(e);
    }
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, fn: (e: { payload: unknown }) => void) => {
    h.hear = fn;
    return Promise.resolve(() => {});
  },
}));
// Counts how often the column groups its list and the picker builds its sections: the memo boundary the lag fix rests on.
vi.mock("../webui/history", async (orig) => {
  const m = await orig<typeof import("../webui/history")>();
  return { ...m, groupSessions: (...a: Parameters<typeof m.groupSessions>) => (h.groups++, m.groupSessions(...a)) };
});
vi.mock("../webui/models", async (orig) => {
  const m = await orig<typeof import("../webui/models")>();
  return { ...m, buildSections: (...a: Parameters<typeof m.buildSections>) => (h.sections++, m.buildSections(...a)) };
});

const OPUS = "openrouter/anthropic/claude-opus-5.5";
const GPT = "openrouter/openai/gpt-5.5";
const MODELS = [
  { id: OPUS, label: "Claude Opus 5.5", provider: "anthropic", efforts: [] },
  { id: GPT, label: "GPT-5.5", provider: "openai", efforts: [] },
];
const readOf = (text: string) => ({ state: "ready", reset: true, items: [{ id: "u1", role: "user", kind: "text", text, at: 1 }], open: false, error: null, retryMs: 0, older: null, earlier: false });
const now = Date.now();
const SESSIONS = [
  { id: "ses_a", title: "Greeting", updatedAt: now },
  { id: "ses_b", title: "Other chat", updatedAt: now - 1000 },
  { id: "ses_blank", title: "New chat", updatedAt: now - 2000 },
];

let doc: FakeDocument;
let unmount: () => Promise<void> = async () => {};
beforeEach(async () => {
  const dom = installDom();
  doc = dom.doc;
  Object.assign(dom.win, { setInterval, clearInterval, setTimeout, clearTimeout, ResizeObserver: undefined });
  // The fake page measures nothing and has no selectors; the pane asks for both.
  const proto = (await import("../../test/fakeDom")).FakeNode.prototype as unknown as Record<string, unknown>;
  proto.getBoundingClientRect = () => ({ width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600 });
  proto.querySelector = () => null;
  proto.getAnimations = () => [];
  (doc as unknown as Record<string, unknown>).getElementById = () => null;
  h.calls.length = 0;
  h.hear = null;
  h.groups = 0;
  h.sections = 0;
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? SESSIONS : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  const { resetSessionBus } = await import("./sessionBus");
  resetSessionBus();
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

type Over = Partial<{ resume: string | null; named: boolean; onSession: (id: string | null) => void; onName: (n: string) => void; onFocus: () => void; key: number; agent: string }>;
async function pane(over: Over = {}): Promise<FakeNode> {
  const { default: ChatPane } = await import("./ChatPane");
  const m = await mount(
    createElement(ChatPane, {
      pane: { key: over.key ?? 1, cwd: "C:/w" },
      agent: over.agent,
      onFocus: over.onFocus ?? (() => {}),
      onClose: () => {},
      named: over.named ?? false,
      onName: over.onName,
      model: OPUS,
      resume: over.resume ?? null,
      onSession: over.onSession,
    }),
    doc,
  );
  unmount = m.unmount;
  return m.container as FakeNode;
}
const starts = (): Call[] => h.calls.filter((c) => c.cmd === "chat_start");
const emit = async (payload: Record<string, unknown>) => {
  const { act } = await import("react");
  await act(async () => h.hear?.({ payload: { chatId: "pane-1", ...payload } }));
};
const said = (c: FakeNode, text: string) => c.textContent.includes(text);

test("an older Claude chat is never opened as a blank one: its words show, a notice says why, and the kept row keeps its id", async () => {
  const { LEGACY_NOTE } = await import("./ChatPane");
  const old = "0b1c2d3e-aaaa-bbbb-cccc-000000000000";
  h.script = (cmd, args) => {
    if (cmd === "chat_models") return MODELS;
    if (cmd === "chat_sessions") return [];
    if (cmd === "artifacts_scan") return { rows: [], skipped: [] };
    if (cmd === "chat_history") return args.agent === "claude" ? readOf("from the old transcript") : Promise.reject("not in OpenCode");
    return undefined;
  };
  const sessions: Array<string | null> = [];
  const c = await pane({ resume: old, onSession: (id) => sessions.push(id) });
  await until(() => said(c, LEGACY_NOTE), "the older-chat notice");
  expect(LEGACY_NOTE).toBe("This older Claude chat can't be reopened here. A new chat starts below.");
  expect(h.calls.some((x) => x.cmd === "chat_history" && x.args.agent === "claude" && x.args.session === old)).toBe(true);
  await until(() => starts().length === 1, "the new chat to start");
  expect(starts()[0].args.resumeSessionId).toBeNull();
  // The new chat names its own id; the kept row is not told, so it keeps the old one.
  await emit({ kind: "init", sessionId: "ses_new" });
  await settle();
  expect(sessions).toEqual([]);
});

test("a chat deleted from another pane's list starts a new chat here, with a line that says why", async () => {
  const { announceDeleted } = await import("./sessionBus");
  const { DELETED_NOTE } = await import("./ChatPane");
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? SESSIONS : cmd === "chat_history" ? readOf("hello") : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  const c = await pane({ resume: "ses_a" });
  await until(() => starts().length === 1, "the first start");
  expect(starts()[0].args.resumeSessionId).toBe("ses_a");
  const { act } = await import("react");
  await act(async () => announceDeleted({ cwd: "C:/w", id: "ses_a", source: 2 }));
  await until(() => starts().length === 2, "the new chat");
  expect(starts()[1].args.resumeSessionId).toBeNull();
  await until(() => said(c, DELETED_NOTE), "the notice");
  // A chat this pane does not show is none of its business.
  await act(async () => announceDeleted({ cwd: "C:/w", id: "ses_zzz", source: 2 }));
  await settle();
  expect(starts()).toHaveLength(2);
});

test("opening a chat another pane already holds brings that pane forward and does not read or resume it here", async () => {
  const { claimSession } = await import("./sessionBus");
  const focus = vi.fn();
  claimSession("ses_b", 99, focus);
  const c = await pane({ resume: "ses_a" });
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? SESSIONS : cmd === "chat_history" ? readOf("hello") : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  await until(() => find(c, (n) => n.attrs.class === "wui-row").length > 0, "the history rows");
  const row = find(c, (n) => n.attrs.class === "wui-row" && n.textContent.includes("Other chat"))[0];
  const before = h.calls.length;
  await click(c, row);
  await settle();
  expect(focus).toHaveBeenCalledTimes(1);
  expect(h.calls.slice(before).some((x) => x.cmd === "chat_history" || x.cmd === "chat_start")).toBe(false);
});

test("the tab and the sidebar row follow the title the history column shows, not the first message", async () => {
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? SESSIONS : cmd === "chat_history" ? readOf("hello there, a long first message") : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  const names: string[] = [];
  await pane({ resume: "ses_a", onName: (n) => names.push(n) });
  await until(() => names.length > 0, "the title");
  expect(names).toEqual(["Greeting"]);
});

test("blank chats do not show as rows, and New chat on a chat nothing was said in starts nothing new", async () => {
  const c = await pane();
  await until(() => find(c, (n) => n.attrs.class === "wui-row").length > 0, "the history rows");
  const titles = find(c, (n) => n.attrs.class === "wui-title").map((n) => n.textContent);
  expect(titles).toEqual(["Greeting", "Other chat"]);
  await until(() => starts().length === 1, "the first start");
  const fresh = find(c, (n) => n.attrs.class === "wui-new")[0];
  await click(c, fresh);
  await click(c, fresh);
  await settle();
  expect(starts()).toHaveLength(1);
});

test("a model switch the engine refuses puts the chat back on its model with a line, not into the error state", async () => {
  const { switchFailed } = await import("./ChatPane");
  const c = await pane();
  await until(() => starts().length === 1, "the first start");
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? SESSIONS : cmd === "chat_start" ? Promise.reject("no such model") : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  const trigger = find(c, (n) => (n.attrs["aria-label"] ?? "").startsWith("Model:"))[0];
  expect(trigger.attrs["aria-label"]).toContain("Claude Opus 5.5");
  await click(c, trigger);
  const option = find(c, (n) => n.attrs.role === "option" && n.attrs.title === GPT)[0];
  await click(c, option);
  await until(() => said(c, "Could not switch to"), "the switch notice");
  expect(said(c, switchFailed("gpt-5.5", "claude-opus-5.5").split(".")[0])).toBe(true);
  expect(find(c, (n) => (n.attrs["aria-label"] ?? "").startsWith("Model:"))[0].attrs["aria-label"]).toContain("Claude Opus 5.5");
  expect(find(c, (n) => n.attrs.role === "alert")).toHaveLength(0);
});

test("streaming a reply does not group the history again or rebuild the model picker's sections", async () => {
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? SESSIONS : cmd === "chat_history" ? readOf("hello") : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  const c = await pane({ resume: "ses_a" });
  await until(() => find(c, (n) => n.attrs.class === "wui-row").length > 0, "the history rows");
  await settle(200);
  const [groups, sections] = [h.groups, h.sections];
  for (let i = 0; i < 25; i++) await emit({ kind: "assistant", messageId: `m${i}`, blocks: [{ type: "text", text: `word ${i}` }] });
  await settle();
  expect(h.groups).toBe(groups);
  expect(h.sections).toBe(sections);
});

test("a restarted OpenCode server (a new pid on `started`) makes the pane read the model list again", async () => {
  await pane();
  await until(() => starts().length === 1, "the start");
  await emit({ kind: "started", pid: 11 });
  await settle(100);
  const asked = () => h.calls.filter((c) => c.cmd === "chat_models").length;
  const before = asked();
  await emit({ kind: "started", pid: 11 });
  await settle(100);
  expect(asked(), "the same server asks nothing new").toBe(before);
  await emit({ kind: "started", pid: 12 });
  await until(() => asked() > before, "a second models request");
});

test.each(["claude", "openclaude", undefined])("a chat opened with the engine name %s starts on OpenCode", async (agent) => {
  await pane({ agent });
  await until(() => starts().length === 1, "the start");
  expect(starts()[0].args.agent).toBe("opencode");
});
