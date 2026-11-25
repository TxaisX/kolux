// CHAT-02 review (P2): a message typed while the agent is replying is queued behind the running turn. It
// must be drawn at the end of that turn, however many assistant, tool or thought rows the turn still
// streams, and the turn must keep its own worked time instead of settling early under the queued send.
// Round 2: a send after a finished turn is not queued, so its own reply goes below it, never above.
import { describe, expect, it } from "vitest";
import { combine, dropCancelled, holdPending, type ChatItem, type Pending } from "./model";
import { fold } from "./steps";

const msg = (id: string, role: ChatItem["role"], text: string, at: number): ChatItem => ({ id, role, kind: "text", text, at });
const pend: Pending = { id: "p1", text: "second", at: 2_500, queued: true };
const tags = (rows: { row: string; id: string }[]) => rows.map((r) => `${r.row}:${r.id}`);

describe("CHAT-02 review (P2): a send typed mid-reply waits out the running turn", () => {
  // The turn's rows at 2 000, 3 000 and 4 000 all arrive after the send at 2 500: they are the turn it was
  // typed into still streaming, not turns of their own.
  const items = [msg("u1", "user", "first", 1_000), msg("a1", "assistant", "working on it", 2_000), msg("a2", "assistant", "still working", 3_000), msg("a3", "assistant", "done", 4_000)];

  it("keeps every streamed row in the running turn and the queued send after them", () => {
    const rows = combine(items, [], null, [pend]);
    expect(tags(rows)).toEqual(["message:u1", "message:a1", "message:a2", "message:a3", "pending:p1"]);
    const v = fold(rows, true);
    expect(v.filter((x) => x.row === "message").map((x) => x.id)).toEqual(["u1", "a1", "a2", "a3"]);
    // The turn is still the one u1 opened: one working line for it, and no early "Worked for" under the send.
    expect(v.filter((x) => x.row === "worked")).toEqual([]);
    expect(v.find((x) => x.row === "working")).toMatchObject({ id: "working-u1", since: 1_000 });
    const p = v.findIndex((x) => x.row === "pending" && x.id === "p1");
    expect(p).toBeGreaterThan(v.findIndex((x) => x.row === "message" && x.id === "a3"));
    expect(v[v.length - 1].row).toBe("responding");
  });

  it("when the turn settles, its worked time covers all its rows and none is charged to the send", () => {
    const v = fold(combine(items, [], null, [pend]), false);
    expect(tags(v)).toEqual(["message:u1", "message:a1", "message:a2", "message:a3", "worked:worked-u1", "pending:p1", "responding:responding"]);
    expect((v[4] as { ms: number }).ms).toBe(3_000);
    expect(v.some((x) => x.row === "worked" && x.id === "worked-p1")).toBe(false);
  });
});

describe("CHAT-02 review round 2: a send after a finished turn sits above its own reply", () => {
  it("no queued send: the reply that arrives before the echo goes below the send", () => {
    // u1's turn finished at a1, so nothing was waiting when "second" was typed at 10 000. The reply to
    // it arrives at 13 000, before the user's echo; it is that send's own reply, so it goes below it.
    const items = [msg("u1", "user", "first", 0), msg("a1", "assistant", "done one", 2_000), msg("a2", "assistant", "done two", 13_000)];
    const rows = combine(items, [], null, [{ id: "p1", text: "second", at: 10_000 }]);
    expect(tags(rows)).toEqual(["message:u1", "message:a1", "pending:p1", "message:a2"]);
  });
});

describe("Bug F: sends a Stop passed over", () => {
  it("holdPending marks unconfirmed sends and keeps the same array when there is nothing to mark", () => {
    const a: Pending = { id: "p1", text: "x", at: 1 };
    const held = holdPending([a]);
    expect(held[0].held).toBe(true);
    expect(holdPending(held)).toBe(held);
    expect(holdPending([])).toEqual([]);
  });
  it("dropCancelled takes the oldest unconfirmed send, and nothing when there is none", () => {
    const a: Pending = { id: "p1", text: "x", at: 1 };
    const b: Pending = { id: "p2", text: "y", at: 2 };
    expect(dropCancelled([a, b])).toEqual([b]);
    const none: Pending[] = [];
    expect(dropCancelled(none)).toBe(none);
  });
  it("a held send at the tail gives no responding row", () => {
    const p: Pending = { id: "p1", text: "second", at: 2_500, queued: true, held: true };
    const v = fold(combine([], [], null, [p]), false);
    expect(v.some((x) => x.row === "responding")).toBe(false);
    expect(v.some((x) => x.row === "pending")).toBe(true);
  });
});
