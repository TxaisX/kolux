// CHAT-02 review (P2): a live pane used to keep every send it ever made and re-check all of them against
// the whole transcript on each streamed row. Confirmed sends leave the kept list once, on an items change,
// and the same array comes back when nothing was confirmed, so the memo only ever scans the sends waiting.
import { describe, expect, it } from "vitest";
import { livePending, prunePending, type ChatItem, type Pending } from "../model";
import pane from "./ChatPane.tsx?raw";

const sent = (n: number): Pending[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, text: `message ${i}`, at: 1_000 + i }));
const echo = (text: string, at: number): ChatItem => ({ id: `u-${text}`, role: "user", kind: "text", text, at });

describe("CHAT-02 review (P2): confirmed sends leave the pane's list", () => {
  it("drops the sends the transcript confirmed and keeps the rest in order", () => {
    const kept = prunePending(sent(100), [echo("message 0", 1_010), echo("message 50", 1_060)]);
    expect(kept).toEqual(livePending(sent(100), [echo("message 0", 1_010), echo("message 50", 1_060)]));
    expect(kept).toHaveLength(98);
    expect(kept[0].id).toBe("p1");
    expect(kept.some((p) => p.id === "p0" || p.id === "p50")).toBe(false);
  });

  it("gives back the same array when nothing was confirmed, so no redraw", () => {
    const xs = sent(20);
    expect(prunePending(xs, [echo("something else", 5_000)])).toBe(xs);
    expect(prunePending(xs, [])).toBe(xs);
  });

  it("a confirmed send stays gone while later rows stream in", () => {
    const xs = sent(3);
    const once = prunePending(xs, [echo("message 1", 1_010)]);
    expect(once.map((p) => p.id)).toEqual(["p0", "p2"]);
    expect(prunePending(once, [echo("message 1", 1_010), echo("someone else", 2_000)])).toBe(once);
  });

  it("the live pane prunes on an items change, before the memo scans the waiting sends", () => {
    const flat = pane.replace(/\s+/g, " ");
    expect(flat).toMatch(/useEffect\(\(\) => \{ setSent\(\(xs\) => prunePending\(xs, items\)\); \}, \[items\]\);/);
    expect(flat).toMatch(/const pending = useMemo\(\(\) => livePending\(sent, items\), \[sent, items\]\);/);
  });
});
