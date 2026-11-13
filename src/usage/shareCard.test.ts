// @vitest-environment node
// USAGE-019: the share card's figures, its post, its picture and its clipboard step.
import { expect, test, vi } from "vitest";
import { CARD_W, cardOf, copyPng, costText, drawCard, postText, xUrl } from "./shareCardData";
import type { Row } from "./tokens";

const row = (day: string, p: Partial<Row> = {}): Row => ({ day, session: "s1", model: "claude-opus-4-8", cwd: "", band: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 0, ...p });
const today = new Date(2026, 9, 19, 12);

test("USAGE-019: the card carries the provider, range, total tokens, cost, top model and one bar per day", () => {
  const rows = [row("2026-10-19", { input: 1_000_000 }), row("2026-10-17", { model: "claude-sonnet-4-5", output: 3_000_000 }), row("2026-10-13", { input: 500_000 })];
  const c = cardOf("claude", rows, "7", today, "en-US");
  expect(c.providerName).toBe("Claude");
  expect(c.rangeLabel).toBe("Last 7 days");
  expect(c.dates).toBe("Oct 13, 2026 – Oct 19, 2026");
  expect(c.tokens).toBe("4.5M");
  expect(c.topModel).toBe("claude-sonnet-4-5");
  expect(c.bars).toHaveLength(7);
  expect(c.bars[0]).toBe(500_000);
  expect(c.bars[6]).toBe(1_000_000);
  expect(c.cost).toMatch(/^\$\d/);
});

test("USAGE-019: all time runs from the first day with use; ranges read in words", () => {
  const rows = [row("2026-09-30", { input: 10 }), row("2026-10-19", { input: 10 })];
  const all = cardOf("claude", rows, "all", today, "en-US");
  expect(all.rangeLabel).toBe("All time");
  expect(all.dates).toBe("Sep 30, 2026 – Oct 19, 2026");
  expect(all.bars).toHaveLength(20);
  expect(cardOf("codex", rows, "90", today, "en-US").rangeLabel).toBe("Last 90 days");
  expect(cardOf("codex", rows, "30", today, "en-US").providerName).toBe("Codex");
});

test("USAGE-019: a cost below one cent shows four decimals, a missing cost shows n/a", () => {
  expect(costText(0.0005, true, "en-US")).toBe("$0.0005");
  expect(costText(0.0099, true, "en-US")).toBe("$0.0099");
  expect(costText(0.01, true, "en-US")).toBe("$0.01");
  expect(costText(41.2, true, "en-US")).toBe("$41.20");
  expect(costText(0, false, "en-US")).toBe("n/a");
  expect(costText(Number.NaN, true, "en-US")).toBe("n/a");
  expect(cardOf("claude", [row("2026-10-19", { input: 100 })], "7", today, "en-US").cost).toBe("$0.0005");
  expect(cardOf("claude", [row("2026-10-19", { model: "no-such-model", input: 100 })], "7", today, "en-US").cost).toBe("n/a");
  expect(cardOf("claude", [], "7", today, "en-US").cost).toBe("n/a");
});

test("USAGE-019: the post names the provider, range, total tokens and cost; the link carries it encoded", () => {
  const c = cardOf("codex", [row("2026-10-19", { model: "gpt-5", input: 2_000_000 })], "30", today, "en-US");
  const t = postText(c);
  expect(t).toContain("Codex");
  expect(t).toContain("last 30 days");
  expect(t).toContain("2M tokens");
  expect(t).toContain(c.cost);
  expect(t).toContain("Kolux");
  const u = xUrl(c);
  expect(u.startsWith("https://x.com/intent/post?text=")).toBe(true);
  expect(decodeURIComponent(u.split("text=")[1])).toBe(t);
  // the open_external command accepts only http, https and mailto
  expect(u).toMatch(/^https:\/\//);
});

test("USAGE-019: the picture draws Kolux's name, the figures, the range and every bar", () => {
  const c = cardOf("claude", [row("2026-10-19", { input: 1_000_000 }), row("2026-10-18", { input: 500_000 })], "7", today, "en-US");
  const texts: string[] = [];
  const rects: number[][] = [];
  const fills: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => {
      if (k === "fillText") return (s: string) => texts.push(s);
      if (k === "fillRect" || k === "roundRect")
        return (...a: number[]) => {
          rects.push(a);
          fills.push(String(t.fillStyle));
        };
      if (k === "measureText") return (s: string) => ({ width: s.length * 10 });
      if (k === "createLinearGradient") return () => ({ addColorStop() {} });
      return k in t ? t[k] : () => {};
    },
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  drawCard(ctx, c, null);
  expect(texts).toContain("Kolux");
  expect(texts).toContain(c.tokens);
  expect(texts).toContain(c.cost);
  expect(texts).toContain(c.rangeLabel);
  expect(texts).toContain(c.dates);
  expect(texts).toContain("Claude");
  expect(texts).toContain("claude-opus-4-8");
  // exactly one bar per day is drawn: bar colour, inside the strip (y 450-570), inside the card
  const bars = rects.filter((r, i) => fills[i] === "#8beeb0" && r[1] >= 450 && r[1] + r[3] <= 570 && r[0] >= 0 && r[0] + r[2] <= CARD_W && r[3] > 0);
  expect(c.bars).toHaveLength(7);
  expect(bars).toHaveLength(c.bars.length);
  // the ground fill and the border are not counted as bars
  expect(rects.length).toBe(1 + c.bars.length);
});

test("USAGE-019: Copy image puts a PNG on the clipboard and says Copied; a failure says so", async () => {
  const blob = new Blob(["x"], { type: "image/png" });
  const canvas = { toBlob: (cb: (b: Blob | null) => void) => cb(blob) } as unknown as HTMLCanvasElement;
  const write = vi.fn(async (_items: unknown[]) => {});
  class Item {
    constructor(public data: Record<string, Blob>) {}
  }
  await expect(copyPng(canvas, { write }, Item as unknown as typeof ClipboardItem)).resolves.toBe(true);
  expect(write).toHaveBeenCalledTimes(1);
  expect((write.mock.calls[0][0][0] as Item).data["image/png"]).toBe(blob);
  const none = { toBlob: (cb: (b: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement;
  await expect(copyPng(none, { write }, Item as unknown as typeof ClipboardItem)).resolves.toBe(false);
  const denied = { write: async () => { throw new Error("denied"); } };
  await expect(copyPng(canvas, denied, Item as unknown as typeof ClipboardItem)).resolves.toBe(false);
  await expect(copyPng(canvas, undefined, undefined)).resolves.toBe(false);
});

test("USAGE-019 FIX-1: a toBlob that throws (a tainted canvas) answers false instead of rejecting", async () => {
  const write = vi.fn(async (_items: unknown[]) => {});
  class Item {
    constructor(public data: Record<string, Blob>) {}
  }
  const tainted = {
    toBlob: () => {
      throw new DOMException("tainted", "SecurityError");
    },
  } as unknown as HTMLCanvasElement;
  await expect(copyPng(tainted, { write }, Item as unknown as typeof ClipboardItem)).resolves.toBe(false);
  expect(write).not.toHaveBeenCalled();
});

test("USAGE-019 FIX-1: a cost that leaves out unpriced models is marked partial on the card and in the post", () => {
  const priced = [row("2026-10-19", { input: 1_000_000 })];
  const mixed = [...priced, row("2026-10-18", { model: "no-such-model", input: 500 })];
  const full = cardOf("claude", priced, "7", today, "en-US");
  const part = cardOf("claude", mixed, "7", today, "en-US");
  expect(full.partial).toBe(false);
  expect(full.cost).toBe("$5.00");
  expect(part.partial).toBe(true);
  expect(part.cost).toBe(`${full.cost}+`);
  expect(postText(part)).toContain(`at least ${full.cost}`);
  expect(postText(full)).toContain(`about ${full.cost}`);
  // nothing priced at all stays n/a, not "n/a+"
  const none = cardOf("claude", [row("2026-10-19", { model: "no-such-model", input: 100 })], "7", today, "en-US");
  expect(none.cost).toBe("n/a");
  expect(none.partial).toBe(false);
  // the picture says which models are left out
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k === "fillText" ? (s: string) => texts.push(s) : k === "measureText" ? (s: string) => ({ width: s.length * 10 }) : k in t ? t[k] : () => {}),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  drawCard(ctx, part, null);
  expect(texts).toContain(part.cost);
  expect(texts.some((x) => /unpriced models left out/i.test(x))).toBe(true);
  texts.length = 0;
  drawCard(ctx, full, null);
  expect(texts.some((x) => /unpriced/i.test(x))).toBe(false);
});

// The dialog itself (the card, Copy image, the one Share on X button, Close) is a src/ui Dialog, drawn only once open:
// ShareCard.dom.test.tsx opens it on a real DOM.
