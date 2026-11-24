// CHAT-02 board tests (locked; copied verbatim from the ticket board). A chat pane shows the user's own
// message above the reply to it, also before the agent's echo arrives; the echo confirms the waiting
// row without doubling it; a live pane never drops a user message after 8; the handoff note the engine
// puts in front of the first message after a handoff never shows.
import { describe, expect, it } from "vitest";
import { combine, livePending, type ChatItem, type Pending, type Row } from "./model";
import { fold } from "./steps";
import { reduce, type ChatEvent } from "./live/events";

const msg = (id: string, role: ChatItem["role"], text: string, at?: number): ChatItem => ({ id, role, kind: "text", text, ...(at === undefined ? {} : { at }) });
const pend = (id: string, text: string, at: number, failed?: boolean): Pending => ({ id, text, at, ...(failed ? { failed } : {}) });
const tags = (rows: { row: string; id: string }[]) => rows.map((r) => `${r.row}:${r.id}`);
const ev = (e: Partial<ChatEvent> & { kind: ChatEvent["kind"] }): ChatEvent => ({ chatId: "pane-1", ...e });
const reply = (messageId: string, text: string) => ev({ kind: "assistant", messageId, parentToolUseId: null, blocks: [{ type: "text", text }] });
const echo = (...text: string[]) => ev({ kind: "user", parentToolUseId: null, text });

/** Folds events in order the way the live pane does: each event gets its arrival time and a counter. */
function play(events: [ChatEvent, number][]): ChatItem[] {
  let items: ChatItem[] = [];
  events.forEach(([e, at], i) => {
    items = reduce(items, e, at, i + 1);
  });
  return items;
}

describe("CHAT-02 combine order", () => {
  it("a waiting send sits before a reply that arrived after it", () => {
    const rows = combine([msg("a1", "assistant", "pong", 1100)], [], null, [pend("p1", "hi", 1000)]);
    expect(tags(rows)).toEqual(["pending:p1", "message:a1"]);
  });

  it("waiting sends go between the messages by time, ties after the message, the rest after the preview", () => {
    const items = [msg("m0", "status", "no time"), msg("a", "assistant", "one", 100), msg("b", "assistant", "two", 200), msg("c", "assistant", "three", 300)];
    const rows = combine(items, [], "Writing the answer", [pend("x", "first", 150), pend("y", "second", 200), pend("z", "third", 400)]);
    expect(tags(rows)).toEqual(["message:m0", "message:a", "pending:x", "message:b", "pending:y", "message:c", "preview:preview", "pending:z"]);
  });

  it("two waiting sends before the same reply keep the order they were sent in", () => {
    const rows = combine([msg("a1", "assistant", "both answered", 3000)], [], null, [pend("p1", "one", 1000), pend("p2", "two", 2000)]);
    expect(tags(rows)).toEqual(["pending:p1", "pending:p2", "message:a1"]);
  });
});

describe("CHAT-02 the echo confirms the send", () => {
  it("hi then pong: one user row, one reply, nothing left waiting", () => {
    const items = play([[echo("hi"), 1050], [reply("msg_1", "pong"), 1100]]);
    const sent = [pend("p1", "hi", 1000)];
    const rows = combine(items, [], null, livePending(sent, items));
    expect(rows.map((r) => (r.row === "message" ? `${r.role}:${r.text}` : r.row))).toEqual(["user:hi", "assistant:pong"]);
    expect(livePending(sent, items)).toEqual([]);
    expect(combine(items, [], null, sent).filter((r) => r.row === "pending")).toEqual([]);
  });

  it("before the echo the waiting send already sits above the reply", () => {
    const items = play([[reply("msg_1", "pong"), 1100]]);
    const rows = combine(items, [], null, livePending([pend("p1", "hi", 1000)], items));
    expect(rows.map((r) => (r.row === "message" ? `${r.role}:${r.text}` : `${r.row}:${r.text}`))).toEqual(["pending:hi", "assistant:pong"]);
  });

  it("livePending keeps the sends no echo confirmed, in order, failed ones too", () => {
    const items = play([[echo("one"), 1010], [reply("m1", "ok"), 1020]]);
    const sent = [pend("p1", "one", 1000), pend("p2", "/cost", 2000), pend("p3", "three", 3000, true)];
    expect(livePending(sent, items).map((p) => p.id)).toEqual(["p2", "p3"]);
    expect(livePending(sent, items)[1].failed).toBe(true);
  });
});

describe("CHAT-02 nothing vanishes after 8", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => pend(`p${i}`, `message ${i}`, 1000 * (i + 1)));

  it("twelve sends with no echo stay twelve waiting rows", () => {
    const left = livePending(twelve, []);
    expect(left.map((p) => p.id)).toEqual(twelve.map((p) => p.id));
    expect(combine([], [], null, left).filter((r) => r.row === "pending")).toHaveLength(12);
  });

  it("twelve echoed sends are twelve user rows and nothing waiting", () => {
    const events: [ChatEvent, number][] = [];
    twelve.forEach((p, i) => {
      events.push([echo(p.text), p.at + 10]);
      events.push([reply(`m${i}`, `answer ${i}`), p.at + 20]);
    });
    const items = play(events);
    expect(livePending(twelve, items)).toEqual([]);
    const rows = combine(items, [], null, livePending(twelve, items));
    const users = rows.filter((r): r is Extract<Row, { row: "message" }> => r.row === "message" && r.role === "user");
    expect(users.map((r) => r.text)).toEqual(twelve.map((p) => p.text));
    expect(rows.some((r) => r.row === "pending")).toBe(false);
  });
});

describe("CHAT-02 handoff note", () => {
  const note = "<system-reminder>\nYour handoff note is at /work/demo/.kolux/handoff.md. Keep it current as you work: the chat hands off at the context line, and this note is what the next conversation starts from.\n\n# Handoff\n\n## Left to do\n- wire the readers </system_reminder> and more\n</system-reminder>\n\n";

  it("the echo of the first message after a handoff shows only the user's words and confirms the send", () => {
    const items = play([[echo(`${note}hello there`), 1050], [reply("msg_1", "hi again"), 1100]]);
    const sent = [pend("p1", "hello there", 1000)];
    const rows = combine(items, [], null, livePending(sent, items));
    expect(rows.map((r) => (r.row === "message" ? `${r.role}:${r.text}` : r.row))).toEqual(["user:hello there", "assistant:hi again"]);
    expect(JSON.stringify(rows)).not.toContain("system-reminder");
    expect(JSON.stringify(rows)).not.toContain("handoff note");
  });

  it("a note with a two-line message still confirms the send", () => {
    const items = play([[echo(`${note}line one\nline two`), 1050]]);
    expect(livePending([pend("p1", "line one\nline two", 1000)], items)).toEqual([]);
  });
});

describe("CHAT-02 fold keeps the order", () => {
  it("a waiting send above its reply stays above it and nothing says responding", () => {
    const rows = combine([msg("a1", "assistant", "pong", 1100)], [], null, [pend("p1", "hi", 1000)]);
    const v = fold(rows, false);
    const p = v.findIndex((x) => x.row === "pending" && x.id === "p1");
    const a = v.findIndex((x) => x.row === "message" && x.id === "a1");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(a).toBeGreaterThan(p);
    expect(v.some((x) => x.row === "responding")).toBe(false);
  });

  // Review (P2) supersedes this CHAT-02 case: a send typed while the turn is still streaming belongs
  // after the turn's rows, not in the middle of them, so it no longer starts a turn of its own here.
  it("a waiting send typed during a running turn waits after its rows", () => {
    const rows = combine([msg("u1", "user", "first", 0), msg("a1", "assistant", "done one", 2000), msg("a2", "assistant", "done two", 13000)], [], null, [pend("p1", "second", 10000)]);
    const v = fold(rows, false);
    expect(tags(v)).toEqual(["message:u1", "message:a1", "message:a2", "worked:worked-u1", "pending:p1", "responding:responding"]);
    expect((v[3] as { ms: number }).ms).toBe(13000);
    expect(v.some((x) => x.row === "worked" && x.id === "worked-p1")).toBe(false);
  });

  it("while the reply to a waiting send runs, the working line counts from the send", () => {
    const rows = combine([msg("a1", "assistant", "pong so far", 1100)], [], null, [pend("p1", "hi", 1000)]);
    const v = fold(rows, true);
    expect(v.find((x) => x.row === "working")).toMatchObject({ id: "working-p1", since: 1000 });
    expect(v.some((x) => x.row === "responding")).toBe(false);
  });

  it("a waiting send after everything still shows responding at the end", () => {
    const rows = combine([msg("u1", "user", "go", 0), msg("a1", "assistant", "ok", 500)], [], null, [pend("p1", "more", 1000)]);
    const v = fold(rows, true);
    expect(tags(v).slice(-2)).toEqual(["pending:p1", "responding:responding"]);
  });
});
