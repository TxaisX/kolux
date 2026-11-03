// CHAT-008 (after-list row 392): the chat asks the backend for an older page when the user scrolls up.
import { beforeEach, describe, expect, it } from "vitest";
import type { ChatItem, ChatRead } from "./model";
import { OLDER_LINES } from "./page";
import { ChatReader, forgetAllKept, takeRead, type Seen, type Timers } from "./reading";

const item = (id: string): ChatItem => ({ id, role: "assistant", kind: "text", text: id });
const ready = (items: ChatItem[], extra: Partial<ChatRead> = {}): ChatRead => ({ state: "ready", reset: false, items, open: false, retryMs: 1000, ...extra });
const ids = (s: Seen) => s.items.map((i) => i.id);
const flush = () => new Promise((r) => setTimeout(r, 0));

function rig() {
  const clock: Timers = { set: () => 0, clear: () => {} };
  const reads: ((r: ChatRead) => void)[] = [];
  const asked: { cursor: number; lines: number; ok: (r: ChatRead) => void; fail: (e: unknown) => void }[] = [];
  const log = { seen: [] as Seen[] };
  const reader = new ChatReader({
    pane: 7,
    session: 1,
    hidden: false,
    read: () => new Promise<ChatRead>((ok) => reads.push(ok)),
    readEarlier: (cursor, lines) => new Promise<ChatRead>((ok, fail) => asked.push({ cursor, lines, ok, fail })),
    close: () => {},
    onChange: (s) => log.seen.push(s),
    timers: clock,
  });
  return { reader, reads, asked, log };
}

beforeEach(() => forgetAllKept());

describe("the cursor a read hands out", () => {
  it("a first or reset read sets it; later reads keep it; a read of the top clears it", () => {
    const first = takeRead({ items: [], state: "loading", error: null, open: false }, ready([item("c")], { reset: true, older: 4096 }), true);
    expect(first.older).toBe(4096);
    const next = takeRead(first, ready([item("d")]), false);
    expect(next.older).toBe(4096);
    expect(ids(next)).toEqual(["c", "d"]);
    const replaced = takeRead(next, ready([item("z")], { reset: true }), false);
    expect(replaced.older).toBeUndefined();
  });
});

describe("loading an older page", () => {
  it("asks for the cursor, puts the page before the rows held and takes the next cursor", async () => {
    const t = rig();
    t.reads[0](ready([item("c"), item("d")], { reset: true, older: 900 }));
    await flush();
    let saved = 0;
    const got = t.reader.loadEarlier(() => void saved++);
    expect(t.asked).toHaveLength(1);
    expect([t.asked[0].cursor, t.asked[0].lines]).toEqual([900, OLDER_LINES]);
    t.asked[0].ok(ready([item("a"), item("b")], { earlier: true, older: 300 }));
    expect(await got).toBe(true);
    expect(saved).toBe(1);
    expect(ids(t.reader.seen)).toEqual(["a", "b", "c", "d"]);
    expect(t.reader.seen.older).toBe(300);
    // The next page reaches the top: no cursor comes back, and the reader asks for no more.
    const last = t.reader.loadEarlier();
    t.asked[1].ok(ready([item("0")], { earlier: true }));
    expect(await last).toBe(true);
    expect(t.reader.seen.older).toBe(0);
    expect(await t.reader.loadEarlier()).toBe(false);
    expect(t.asked).toHaveLength(2);
  });

  it("asks nothing while a page is out, or when the transcript is read from the top", async () => {
    const t = rig();
    t.reads[0](ready([item("c")], { reset: true }));
    await flush();
    expect(await t.reader.loadEarlier()).toBe(false);
    expect(t.asked).toHaveLength(0);
    const u = rig();
    u.reads[0](ready([item("c")], { reset: true, older: 50 }));
    await flush();
    const one = u.reader.loadEarlier();
    expect(await u.reader.loadEarlier()).toBe(false);
    expect(u.asked).toHaveLength(1);
    u.asked[0].ok(ready([item("b")], { earlier: true }));
    await one;
  });

  it("a page that arrives after the chat was hidden, or after the view was replaced, is dropped", async () => {
    const t = rig();
    t.reads[0](ready([item("c")], { reset: true, older: 900 }));
    await flush();
    const hidden = t.reader.loadEarlier();
    t.reader.hide();
    t.asked[0].ok(ready([item("b")], { earlier: true, older: 100 }));
    expect(await hidden).toBe(false);
    expect(ids(t.reader.seen)).toEqual(["c"]);

    const u = rig();
    u.reads[0](ready([item("c")], { reset: true, older: 900 }));
    await flush();
    const stale = u.reader.loadEarlier();
    u.reader.show(); // no-op while shown; the file is replaced by a poll instead
    u.reader.seen = takeRead(u.reader.seen, ready([item("n")], { reset: true, older: 77 }), false);
    u.asked[0].ok(ready([item("b")], { earlier: true, older: 100 }));
    expect(await stale).toBe(false);
    expect(ids(u.reader.seen)).toEqual(["n"]);
  });

  it("a failed call changes nothing and the control can be pressed again", async () => {
    const t = rig();
    t.reads[0](ready([item("c")], { reset: true, older: 900 }));
    await flush();
    let told = 0;
    const failed = t.reader.loadEarlier(undefined, () => void told++);
    t.asked[0].fail(new Error("cursor is not a line start"));
    expect(await failed).toBe(false);
    expect(told).toBe(1); // the view shows its retry note
    expect(ids(t.reader.seen)).toEqual(["c"]);
    expect(t.reader.seen.older).toBe(900);
    const again = t.reader.loadEarlier();
    expect(t.asked).toHaveLength(2);
    t.asked[1].ok(ready([item("b")], { earlier: true }));
    expect(await again).toBe(true);
  });

  it("a reader built without a way to page back never asks", async () => {
    const reads: ((r: ChatRead) => void)[] = [];
    const reader = new ChatReader({ pane: 8, session: 1, hidden: false, read: () => new Promise<ChatRead>((ok) => reads.push(ok)), close: () => {}, onChange: () => {}, timers: { set: () => 0, clear: () => {} } });
    reads[0](ready([item("c")], { reset: true, older: 900 }));
    await flush();
    expect(await reader.loadEarlier()).toBe(false);
  });
});
