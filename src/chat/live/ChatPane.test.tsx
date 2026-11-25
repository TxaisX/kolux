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
  const { resetProbes } = await import("../webui/probe");
  resetProbes();
  const { resetSessionBus } = await import("./sessionBus");
  resetSessionBus();
});
afterEach(async () => {
  await unmount();
  unmount = async () => {};
});

type Over = Partial<{ resume: string | null; legacyId: string | null; named: boolean; onSession: (id: string | null, legacy?: string | null) => void; onReveal: () => void; onEffort: (e: string | null) => void; onName: (n: string | null) => void; onFocus: () => void; key: number; agent: string; hidden: boolean }>;
async function pane(over: Over = {}): Promise<FakeNode> {
  const { default: ChatPane } = await import("./ChatPane");
  const m = await mount(
    createElement(ChatPane, {
      pane: { key: over.key ?? 1, cwd: "C:/w" },
      agent: over.agent,
      hidden: over.hidden,
      onFocus: over.onFocus ?? (() => {}),
      onClose: () => {},
      named: over.named ?? false,
      onName: over.onName,
      model: OPUS,
      resume: over.resume ?? null,
      onSession: over.onSession,
      legacyId: over.legacyId ?? null,
      onReveal: over.onReveal,
      onEffort: over.onEffort,
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
  const sessions: Array<[string | null, string | null | undefined]> = [];
  const c = await pane({ resume: old, onSession: (id, legacy) => sessions.push([id, legacy]) });
  await until(() => said(c, LEGACY_NOTE), "the older-chat notice");
  expect(LEGACY_NOTE).toBe("This older Claude chat can't be reopened here. A new chat starts below.");
  expect(h.calls.some((x) => x.cmd === "chat_history" && x.args.agent === "claude" && x.args.session === old)).toBe(true);
  await until(() => starts().length === 1, "the new chat to start");
  expect(starts()[0].args.resumeSessionId).toBeNull();
  // The new chat names its own id; until something is sent in it the kept row keeps the old one.
  await emit({ kind: "init", sessionId: "ses_new" });
  await settle();
  expect(sessions).toEqual([]);
  // Review 2 P2-4: the first send makes the new chat real. Its id is reported with the old Claude id beside it,
  // so a restart still shows the old transcript above and does not open a blank chat.
  await sendText(c, "carry on from there");
  await until(() => h.calls.some((x) => x.cmd === "chat_send"), "the send");
  expect(sessions).toEqual([["ses_new", old]]);
});

test("review 2 P2-4: a chat continued on OpenCode reopens with the old Claude transcript above its own words", async () => {
  const old = "0b1c2d3e-aaaa-bbbb-cccc-000000000000";
  h.script = (cmd, args) => {
    if (cmd === "chat_models") return MODELS;
    if (cmd === "chat_sessions") return SESSIONS;
    if (cmd === "artifacts_scan") return { rows: [], skipped: [] };
    if (cmd === "chat_history") return args.agent === "claude" ? readOf("said in the old Claude chat") : readOf("said after the move");
    return undefined;
  };
  const c = await pane({ resume: "ses_a", legacyId: old });
  await until(() => said(c, "said after the move"), "the new transcript");
  expect(said(c, "said in the old Claude chat")).toBe(true);
  expect(c.textContent.indexOf("said in the old Claude chat")).toBeLessThan(c.textContent.indexOf("said after the move"));
  await until(() => starts().length === 1, "the start");
  expect(starts()[0].args.resumeSessionId).toBe("ses_a");
});

test("round 3 P3: a continued chat whose new OpenCode session is gone still shows the old Claude transcript above its fresh start", async () => {
  const old = "0b1c2d3e-aaaa-bbbb-cccc-000000000000";
  h.script = (cmd, args) => {
    if (cmd === "chat_models") return MODELS;
    if (cmd === "chat_sessions") return SESSIONS;
    if (cmd === "artifacts_scan") return { rows: [], skipped: [] };
    if (cmd === "chat_history") return args.agent === "claude" ? readOf("said in the old Claude chat") : Promise.reject("That chat is not in OpenCode anymore.");
    return undefined;
  };
  const c = await pane({ resume: "ses_gone", legacyId: old });
  await until(() => starts().length === 1, "the start");
  expect(starts()[0].args.resumeSessionId).toBeNull();
  expect(said(c, "said in the old Claude chat")).toBe(true);
});

test("review 2 P3-11: OpenCode being out of reach keeps the saved chat and offers Try again; it is not replaced by a blank one", async () => {
  const { UNREACHABLE_NOTE } = await import("./ChatPane");
  let reachable = false;
  h.script = (cmd) => {
    if (cmd === "chat_models") return MODELS;
    if (cmd === "chat_sessions") return SESSIONS;
    if (cmd === "artifacts_scan") return { rows: [], skipped: [] };
    if (cmd === "chat_history") return reachable ? readOf("still here") : Promise.reject("error sending request: connection refused");
    return undefined;
  };
  const sessions: Array<string | null> = [];
  const c = await pane({ resume: "ses_a", onSession: (id) => sessions.push(id) });
  await until(() => said(c, UNREACHABLE_NOTE), "the retry line");
  await settle(60);
  expect(starts()).toHaveLength(0);
  expect(sessions).toEqual([]);
  reachable = true;
  await click(c, find(c, (n) => n.textContent === "Try again")[0]);
  await until(() => said(c, "still here"), "the chat after the retry");
  await until(() => starts().length === 1, "the start");
  expect(starts()[0].args.resumeSessionId).toBe("ses_a");
});

test("review 2 P3-8: a refused effort pick puts the effort back on the record too", async () => {
  const efforts = [{ ...MODELS[0], efforts: ["low", "high"] }, MODELS[1]];
  // The model list is kept between panes; a restarted server (a new pid) drops it, so this list is the one read.
  const { noteServer } = await import("../opencode");
  noteServer(1001);
  noteServer(1002);
  h.script = (cmd) => (cmd === "chat_models" ? efforts : cmd === "chat_sessions" ? SESSIONS : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  const seen: Array<string | null> = [];
  const c = await pane({ onEffort: (e) => seen.push(e) });
  await until(() => starts().length === 1, "the first start");
  await until(() => find(c, (n) => n.attrs["aria-label"] === "Effort").length > 0, "the effort picker");
  h.script = (cmd) => (cmd === "chat_models" ? efforts : cmd === "chat_sessions" ? SESSIONS : cmd === "chat_start" ? Promise.reject("no such effort") : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  const select = find(c, (n) => n.attrs["aria-label"] === "Effort")[0];
  const { fire } = await import("../../test/fakeDom");
  Object.getOwnPropertyDescriptor((await import("../../test/fakeDom")).FakeNode.prototype, "value")!.set!.call(select, "high");
  await fire(c, "change", select);
  await until(() => said(c, "Could not switch"), "the switch notice");
  expect(seen).toEqual(["high", null]);
});

test("live B: a chat another pane holds is brought into view (its tab and folder), not only marked focused", async () => {
  const { holderOf } = await import("./sessionBus");
  const reveal = vi.fn();
  const focus = vi.fn();
  readingScript();
  const c = await pane({ key: 5, resume: "ses_b", onReveal: reveal, onFocus: focus });
  await until(() => find(c, (n) => n.attrs.class === "wui-row").length > 0, "the rows");
  // Another pane asks to open the chat this one holds: the bus calls the reveal, which goes to the window's openPane.
  holderOf("ses_b", 99)!.focus();
  expect(reveal).toHaveBeenCalledTimes(1);
  expect(focus).not.toHaveBeenCalled();
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
  const names: (string | null)[] = [];
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

// --- Titles (review 2, P2-3 and P3-10) -------------------------------------------------------------
const SENT = "hello there friend";
async function sendText(c: FakeNode, text: string) {
  const { typeInto, fire } = await import("../../test/fakeDom");
  const box = find(c, (n) => n.localName === "textarea")[0];
  await typeInto(c, box, text);
  await fire(c, "keydown", box, { key: "Enter", keyCode: 13, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, nativeEvent: { isComposing: false } });
}
const readingScript = () => (h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? SESSIONS : cmd === "chat_history" ? readOf("hello") : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined));

test("a blank chat's 'New chat' is never pushed onto the tab; the first message names it", async () => {
  const names: (string | null)[] = [];
  const c = await pane({ onName: (n) => names.push(n) });
  await until(() => starts().length === 1, "the start");
  await emit({ kind: "init", sessionId: "ses_blank" });
  await settle(100);
  expect(names).toEqual([]);
  await sendText(c, SENT);
  await until(() => h.calls.some((x) => x.cmd === "chat_send"), "the send");
  expect(names).toEqual([SENT]);
});

test("a pane the user did not name keeps following the history column after a restore, even with a title on it", async () => {
  readingScript();
  const names: (string | null)[] = [];
  // A restored pane carries its last automatic title in `pane.title`, with named false.
  const { default: ChatPane } = await import("./ChatPane");
  const m = await mount(createElement(ChatPane, { pane: { key: 1, cwd: "C:/w", title: "hello" }, onFocus: () => {}, onClose: () => {}, named: false, onName: (n: string | null) => names.push(n), model: OPUS, resume: "ses_a" }), doc);
  unmount = m.unmount;
  await until(() => names.length > 0, "the title");
  expect(names).toEqual(["Greeting"]);
  // A restored chat that already has messages is not renamed by a later first send.
  await sendText(m.container as FakeNode, "another thing");
  await until(() => h.calls.some((x) => x.cmd === "chat_send"), "the send");
  expect(names).toEqual(["Greeting"]);
});

test("renaming by hand before the column's first report is not overwritten", async () => {
  readingScript();
  const names: (string | null)[] = [];
  const { useState } = await import("react");
  const { default: ChatPane } = await import("./ChatPane");
  let rename: () => void = () => {};
  // The sessions list is held back so the user's rename lands first.
  let release: (v: unknown) => void = () => {};
  const held = new Promise((r) => (release = r));
  const base = h.script;
  h.script = (cmd, args) => (cmd === "chat_sessions" ? held : base(cmd, args));
  function Harness() {
    const [named, setNamed] = useState(false);
    rename = () => setNamed(true);
    return createElement(ChatPane, { pane: { key: 1, cwd: "C:/w" }, onFocus: () => {}, onClose: () => {}, named, onName: (n: string | null) => names.push(n), model: OPUS, resume: "ses_a" });
  }
  const m = await mount(createElement(Harness), doc);
  unmount = m.unmount;
  await settle(60);
  const { act } = await import("react");
  await act(async () => rename());
  release(SESSIONS);
  await settle(100);
  expect(names).toEqual([]);
});

test("review 2 P2-5: blank means no words in it, not the title 'New chat': a chat with messages shows, an empty one stays hidden", async () => {
  const sessions = [
    { id: "ses_a", title: "Greeting", updatedAt: now },
    { id: "ses_said", title: "New chat", updatedAt: now - 1000 },
    { id: "ses_empty", title: "New chat", updatedAt: now - 2000 },
  ];
  h.script = (cmd, args) => {
    if (cmd === "chat_models") return MODELS;
    if (cmd === "chat_sessions") return sessions;
    if (cmd === "artifacts_scan") return { rows: [], skipped: [] };
    if (cmd === "chat_history") return args.session === "ses_said" ? readOf("I did talk here") : { ...readOf(""), items: [] };
    return undefined;
  };
  const c = await pane();
  await until(() => find(c, (n) => n.attrs.class === "wui-title").length >= 2, "the rows after the content check");
  const titles = find(c, (n) => n.attrs.class === "wui-title").map((n) => n.textContent);
  expect(titles).toEqual(["Greeting", "New chat"]);
});

test("round 3 P3: New chat and opening another chat clear the automatic title, and going back brings the column's title again", async () => {
  readingScript();
  const names: (string | null)[] = [];
  const c = await pane({ resume: "ses_a", onName: (n) => names.push(n) });
  await until(() => names.length > 0, "the title");
  expect(names).toEqual(["Greeting"]);
  await click(c, find(c, (n) => n.attrs.class === "wui-new")[0]);
  await until(() => names.length === 2, "the title cleared by New chat");
  expect(names).toEqual(["Greeting", null]);
  await click(c, find(c, (n) => n.attrs.class === "wui-row" && n.textContent.includes("Other chat"))[0]);
  await until(() => names[names.length - 1] === "Other chat", "the opened chat's title");
  expect(names[names.length - 2]).toBeNull();
  // back to the first chat: its title comes again, though the column reported it before
  await click(c, find(c, (n) => n.attrs.class === "wui-row" && n.textContent.includes("Greeting"))[0]);
  await until(() => names[names.length - 1] === "Greeting", "the first chat's title again");
});

test("round 3 P3: a name the user chose is not cleared by New chat", async () => {
  readingScript();
  const names: (string | null)[] = [];
  const c = await pane({ resume: "ses_a", named: true, onName: (n) => names.push(n) });
  await until(() => find(c, (n) => n.attrs.class === "wui-row").length > 0, "the rows");
  await click(c, find(c, (n) => n.attrs.class === "wui-new")[0]);
  await settle(100);
  expect(names).toEqual([]);
});

test("round 3 P3: a past chat with nothing said in it is still named by its first message", async () => {
  h.script = (cmd, args) =>
    cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? SESSIONS : cmd === "chat_history" ? (args.session === "ses_b" ? { ...readOf(""), items: [] } : readOf("hello")) : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined;
  const names: (string | null)[] = [];
  const c = await pane({ resume: "ses_a", onName: (n) => names.push(n) });
  await until(() => find(c, (n) => n.attrs.class === "wui-row").length > 0, "the rows");
  await click(c, find(c, (n) => n.attrs.class === "wui-row" && n.textContent.includes("Other chat"))[0]);
  await until(() => starts().length >= 2, "the resume");
  await sendText(c, "a brand new thought");
  await until(() => names.includes("a brand new thought"), "the first message as the name");
});

test("round 3 P3: a title OpenCode writes late is picked up by re-listing after the reply, twice, then it stops", async () => {
  const { LATE_TITLE } = await import("../webui/HistoryColumn");
  LATE_TITLE.first = 30;
  LATE_TITLE.second = 30;
  let sessions: unknown[] = [{ id: "ses_new", title: "New chat", updatedAt: Date.now() }];
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? sessions : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  const names: (string | null)[] = [];
  const c = await pane({ onName: (n) => names.push(n) });
  await until(() => starts().length === 1, "the start");
  await emit({ kind: "init", sessionId: "ses_new" });
  await sendText(c, "Reply with the word ok");
  await emit({ kind: "assistant", messageId: "m1", blocks: [{ type: "text", text: "ok" }] });
  await emit({ kind: "result" });
  await settle(30);
  const lists = () => h.calls.filter((x) => x.cmd === "chat_sessions").length;
  // the title lands on the server only after the reply was listed: nothing else triggers a list
  sessions = [{ id: "ses_new", title: "Acknowledgment response", updatedAt: Date.now() }];
  await until(() => names.includes("Acknowledgment response"), "the late title");
  // and a title that never comes stops being asked for
  sessions = [{ id: "ses_new", title: "New chat", updatedAt: Date.now() }];
  const before = lists();
  await emit({ kind: "result" });
  // (short waits: a React update made by a timer is applied when the wait's act scope ends)
  for (let i = 0; i < 30; i++) await settle(20);
  // the reply's own list, then the two late ones, and no more
  expect(lists() - before).toBe(3);
  for (let i = 0; i < 15; i++) await settle(20);
  expect(lists() - before).toBe(3);
});

const stopButtons = (c: FakeNode) => find(c, (n) => n.localName === "button" && n.attrs["aria-label"] === "Stop");

test("round 4 P2-2: after the engine loses OpenCode's stream, Stop stays so the run can be interrupted, until a new turn or the stop answers", async () => {
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? [] : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : cmd === "chat_stop" ? "ended" : undefined);
  const c = await pane();
  await until(() => starts().length === 1, "the start");
  await emit({ kind: "init", sessionId: "ses_new" });
  expect(stopButtons(c)).toHaveLength(0);
  await emit({ kind: "result", subtype: "connection_lost", isError: true, errors: ["Lost OpenCode's event stream."] });
  // the turn is closed on the page, yet OpenCode may still be running it: Stop is offered
  expect(stopButtons(c)).toHaveLength(1);
  await click(c, stopButtons(c)[0]);
  await until(() => h.calls.some((x) => x.cmd === "chat_stop"), "the stop");
  // the engine answers a stop with a stopped event, which closes the doubt
  await emit({ kind: "stopped", how: "ended" });
  expect(stopButtons(c)).toHaveLength(0);
});

test("round 4 P2-2: a new turn's init or a plain result takes the lost-run Stop away", async () => {
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? [] : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  const c = await pane();
  await until(() => starts().length === 1, "the start");
  await emit({ kind: "init", sessionId: "ses_new" });
  await emit({ kind: "result", subtype: "connection_lost", isError: true });
  expect(stopButtons(c)).toHaveLength(1);
  await emit({ kind: "init", sessionId: "ses_new" });
  expect(stopButtons(c)).toHaveLength(0);
  await emit({ kind: "result", subtype: "connection_lost", isError: true });
  expect(stopButtons(c)).toHaveLength(1);
  await emit({ kind: "result", subtype: "success" });
  expect(stopButtons(c)).toHaveLength(0);
});

const probeSessions = [
  { id: "ses_a", title: "Greeting", updatedAt: now },
  { id: "ses_said", title: "New chat", updatedAt: now - 1000 },
  { id: "ses_empty", title: "New chat", updatedAt: now - 2000 },
];
const probeScript = () =>
  (h.script = (cmd, args) => {
    if (cmd === "chat_models") return MODELS;
    if (cmd === "chat_sessions") return probeSessions;
    if (cmd === "artifacts_scan") return { rows: [], skipped: [] };
    if (cmd === "chat_history") return args.session === "ses_said" ? readOf("I did talk here") : { ...readOf(""), items: [] };
    return undefined;
  });
const probes = () => h.calls.filter((c) => c.cmd === "chat_history");

test("round 3 P2 lag: the blank-row reads ask for one message, and a second pane reuses the first pane's answers", async () => {
  probeScript();
  const first = await pane();
  await until(() => find(first, (n) => n.attrs.class === "wui-title").length >= 2, "the rows after the content check");
  expect(probes().map((c) => c.args.session).sort()).toEqual(["ses_empty", "ses_said"]);
  expect(probes().every((c) => c.args.limit === 1)).toBe(true);
  await unmount();
  h.calls.length = 0;
  const second = await pane({ key: 2 });
  await until(() => find(second, (n) => n.attrs.class === "wui-title").length >= 2, "the second pane's rows");
  expect(find(second, (n) => n.attrs.class === "wui-title").map((n) => n.textContent)).toEqual(["Greeting", "New chat"]);
  expect(probes()).toEqual([]);
});

test("round 3 P2 lag: a hidden pane reads nothing for its blank rows", async () => {
  probeScript();
  await pane({ hidden: true });
  await settle(120);
  expect(probes()).toEqual([]);
});

test("live A: after New chat and a first reply, the header, the Everyday row and the history column all carry the title OpenCode gives", async () => {
  const { useState } = await import("react");
  const { default: ChatPane } = await import("./ChatPane");
  const { withAutoTitle } = await import("../../shell/window/chatRecord");
  const { setEverydayName } = await import("../../projects/everydayChats");
  let sessions: unknown[] = [{ id: "ses_new", title: "New chat", updatedAt: Date.now() }];
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? sessions : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : undefined);
  let seen: { title: string | undefined; row: string } = { title: undefined, row: "New chat" };
  // The window's glue, as Pane.tsx wires it: the chat's own name goes to the pane record and the Everyday row.
  function Harness() {
    const [panes, setPanes] = useState([{ key: 1, title: undefined as string | undefined }] as never[]);
    const [chats, setChats] = useState([{ id: "e1", name: "New chat", agent: "opencode", at: 1 }] as never[]);
    const onName = (name: string | null) => {
      setPanes((ps) => withAutoTitle(ps as never, 1, name) as never[]);
      setChats((l) => setEverydayName(l as never, "e1", name) as never[]);
    };
    seen = { title: (panes[0] as { title?: string }).title, row: (chats[0] as { name: string }).name };
    return createElement(ChatPane, { pane: { key: 1, cwd: "C:/w", title: (panes[0] as { title?: string }).title }, onFocus: () => {}, onClose: () => {}, named: false, onName, model: OPUS, resume: null });
  }
  const m = await mount(createElement(Harness), doc);
  unmount = m.unmount;
  const c = m.container as FakeNode;
  await until(() => starts().length === 1, "the start");
  await emit({ kind: "init", sessionId: "ses_new" });
  await sendText(c, "Reply with the word ok");
  await until(() => seen.title === "Reply with the word ok", "the first message as the name");
  // OpenCode titles the chat; the list answers with it after the reply.
  sessions = [{ id: "ses_new", title: "Acknowledgment response", updatedAt: Date.now() }];
  await emit({ kind: "assistant", messageId: "m1", blocks: [{ type: "text", text: "ok" }] });
  await emit({ kind: "result" });
  await until(() => seen.title === "Acknowledgment response", "the header to take the server title");
  expect(seen.row).toBe("Acknowledgment response");
  await until(() => find(c, (n) => n.attrs.class === "wui-title").some((n) => n.textContent === "Acknowledgment response"), "the column row");
});

// Bug F: a message queued behind a long turn, then Stop. The engine asks OpenCode to cancel it; each confirmed
// cancel is one `result` with subtype "cancelled" and no echo. The bubble must not stay on "Responding...".
const queuedScene = async () => {
  h.script = (cmd) => (cmd === "chat_models" ? MODELS : cmd === "chat_sessions" ? [] : cmd === "artifacts_scan" ? { rows: [], skipped: [] } : cmd === "chat_stop" ? "interrupt" : undefined);
  const c = await pane();
  await until(() => starts().length === 1, "the start");
  await emit({ kind: "init", sessionId: "ses_q" });
  await sendText(c, "a very long prompt");
  await until(() => h.calls.filter((x) => x.cmd === "chat_send").length === 1, "the first send");
  await emit({ kind: "user", text: ["a very long prompt"] });
  await sendText(c, "say cherry");
  await until(() => h.calls.filter((x) => x.cmd === "chat_send").length === 2, "the queued send");
  await settle(50);
  return c;
};

test("bug F: a queued bubble is removed by a cancelled result", async () => {
  const c = await queuedScene();
  expect(said(c, "say cherry")).toBe(true);
  await emit({ kind: "stopped", how: "interrupt" });
  await emit({ kind: "result", subtype: "cancelled", isError: true, errors: ["Stopped before it ran."] });
  expect(said(c, "say cherry")).toBe(false);
  expect(said(c, "Responding")).toBe(false);
  expect(said(c, "A message was not run.")).toBe(true);
});

test("bug F: after stopped, an unconfirmed queued bubble shows Waiting to send, never Responding", async () => {
  const c = await queuedScene();
  expect(said(c, "Responding")).toBe(true);
  await emit({ kind: "stopped", how: "interrupt" });
  expect(said(c, "say cherry")).toBe(true);
  expect(said(c, "Responding")).toBe(false);
  expect(said(c, "Waiting to send")).toBe(true);
});

test("bug F: a held queued bubble is cleared by a later echo", async () => {
  const c = await queuedScene();
  await emit({ kind: "stopped", how: "interrupt" });
  expect(said(c, "Waiting to send")).toBe(true);
  await emit({ kind: "user", text: ["say cherry"] });
  await settle(50);
  expect(said(c, "Waiting to send")).toBe(false);
  expect(said(c, "Responding")).toBe(false);
  expect(find(c, (n) => String(n.attrs.class ?? "").includes("pending"))).toHaveLength(0);
  expect(said(c, "say cherry")).toBe(true);
});
