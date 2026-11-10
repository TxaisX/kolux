import { describe, expect, it } from "vitest";
import { HeldKeys, screenLines, shouldRefocus, watchScale } from "./recover";

describe("TERM-114: typing goes back to the pane that had it", () => {
  const body = { tagName: "BODY" } as Element;
  it("refocuses the focused pane when nothing else took the keyboard", () => {
    expect(shouldRefocus(true, null)).toBe(true);
    expect(shouldRefocus(true, body)).toBe(true);
  });
  it("leaves the keyboard where the user clicked meanwhile", () => {
    expect(shouldRefocus(true, { tagName: "INPUT" } as Element)).toBe(false);
  });
  it("never steals focus for a pane that was not the focused one", () => {
    expect(shouldRefocus(false, body)).toBe(false);
  });
  it("re-arms the scale watcher at each new ratio and fires once per change", () => {
    const queries: string[] = [];
    const handlers: (() => void)[] = [];
    let ratio = 1;
    const mq = (q: string) => {
      queries.push(q);
      return { addEventListener: (_: "change", h: () => void) => handlers.push(h), removeEventListener: () => handlers.pop() };
    };
    let fired = 0;
    const w = watchScale(() => fired++, () => ratio, mq as never);
    expect(queries).toEqual(["(resolution: 1dppx)"]);
    ratio = 1.5;
    handlers[0]();
    expect(fired).toBe(1);
    expect(queries[1]).toBe("(resolution: 1.5dppx)");
    w.dispose();
    expect(handlers).toHaveLength(0);
  });
});

describe("TERM-115: keys typed before the terminal connects", () => {
  it("are held in order and sent once it connects, then held no more", () => {
    const held = new HeldKeys(64);
    expect(held.push("ab")).toBe(true);
    expect(held.push("c\r")).toBe(true);
    const sent: string[] = [];
    held.drain((d) => sent.push(d));
    expect(sent).toEqual(["abc\r"]);
    held.drain((d) => sent.push(d));
    expect(sent).toEqual(["abc\r"]);
  });
  it("caps what is held and counts what was dropped past the cap", () => {
    const held = new HeldKeys(4);
    held.push("1234");
    expect(held.push("5")).toBe(false);
    held.push("67");
    const sent: string[] = [];
    held.drain((d) => sent.push(d));
    expect(sent).toEqual(["1234"]);
    expect(held.dropped).toBe(3);
  });
});

describe("screenLines", () => {
  const bufOf = (rows: [string, boolean][]) => ({ length: rows.length, getLine: (y: number) => (rows[y] ? { isWrapped: rows[y][1], translateToString: () => rows[y][0] } : undefined) });
  it("joins a soft-wrapped line back into one so a secret is never split across rows", () => {
    const buf = bufOf([["$ echo 'Authorization: Bearer sk", false], ["-live-1234567890abcdef'", true], ["Authorization: Bearer sk-live-1234567890abcdef", false], ["$ ", false]]);
    expect(screenLines(buf)).toEqual(["$ echo 'Authorization: Bearer sk-live-1234567890abcdef'", "Authorization: Bearer sk-live-1234567890abcdef", "$ "]);
  });
  it("walks back to the first row when the cut lands on a continuation row", () => {
    const buf = bufOf([["old", false], ["head", false], ["-tail", true], ["last", false]]);
    expect(screenLines(buf, 2)).toEqual(["head-tail", "last"]);
  });
});

describe("DT-C247: a reply held before the terminal connects", () => {
  it("is sent as a reply, typed keys as typing, in order, neighbours of one kind joined", () => {
    const held = new HeldKeys(64);
    held.push("[1;1R", true); // the console's opening cursor query, answered before the id is known
    held.push("a");
    held.push("b");
    held.push("[O", true);
    const sent: [string, boolean][] = [];
    held.drain((d, auto) => sent.push([d, auto]));
    expect(sent).toEqual([
      ["[1;1R", true],
      ["ab", false],
      ["[O", true],
    ]);
  });
});
