// Round 3 P2 (lag): the "is anything said in this chat" reads are shared by every pane, deduplicated, capped and light.
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as Array<{ id: string; limit?: number }>, gates: [] as Array<() => void>, open: 0, peak: 0, mode: "now" as "now" | "hold" | "fail" }));
vi.mock("../live/client", () => ({
  chatHistory: (_agent: string, _cwd: string, id: string, limit?: number) => {
    h.calls.push({ id, limit });
    if (h.mode === "fail") return Promise.reject(new Error("could not reach"));
    const r = { items: id.startsWith("empty") ? [] : [{ id: "m" }] };
    if (h.mode === "now") return Promise.resolve(r);
    h.open++;
    h.peak = Math.max(h.peak, h.open);
    return new Promise((done) =>
      h.gates.push(() => {
        h.open--;
        done(r);
      }),
    );
  },
}));

const { MAX_PROBES, RETRY_AFTER_MS, probeChat, probed, resetProbes } = await import("./probe");

beforeEach(() => {
  resetProbes();
  h.calls = [];
  h.gates = [];
  h.open = 0;
  h.peak = 0;
  h.mode = "now";
});

test("two panes asking about the same chat share one read, and the read asks for one message", async () => {
  h.mode = "hold";
  const a = probeChat("C:/w", "ses_1", 5);
  const b = probeChat("C:/w", "ses_1", 5);
  await Promise.resolve();
  h.gates.forEach((g) => g());
  expect(await a).toBe(true);
  expect(await b).toBe(true);
  expect(h.calls).toEqual([{ id: "ses_1", limit: 1 }]);
});

test("an answer is kept for every pane: a later ask makes no read, for a chat with words or an empty one", async () => {
  expect(await probeChat("C:/w", "ses_1", 5)).toBe(true);
  expect(await probeChat("C:/w", "empty_1", 5)).toBe(false);
  expect(probed("C:/w", "ses_1", 5)).toBe(true);
  expect(probed("C:/w", "empty_1", 5)).toBe(false);
  h.calls = [];
  expect(await probeChat("C:/w", "ses_1", 5)).toBe(true);
  expect(await probeChat("C:/w", "empty_1", 5)).toBe(false);
  expect(h.calls).toEqual([]);
  // a chat that was changed (a new updatedAt) is asked again
  await probeChat("C:/w", "empty_1", 6);
  expect(h.calls).toEqual([{ id: "empty_1", limit: 1 }]);
});

test("no more than three reads are out at once across all panes", async () => {
  h.mode = "hold";
  const all = Array.from({ length: 10 }, (_, i) => probeChat("C:/w", `ses_${i}`, 1));
  await Promise.resolve();
  expect(MAX_PROBES).toBe(3);
  expect(h.calls.length).toBe(3);
  // each finished read lets the next one start, never more than three at a time
  for (let guard = 0; guard < 20 && h.gates.length > 0; guard++) {
    h.gates.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  }
  expect((await Promise.all(all)).every((x) => x === true)).toBe(true);
  expect(h.calls.length).toBe(10);
  expect(h.peak).toBe(3);
});

test("a read that failed is not kept as empty: not asked again for a minute, asked again after, and at once for a changed chat", async () => {
  h.mode = "fail";
  expect(await probeChat("C:/w", "ses_1", 5, 1000)).toBeNull();
  expect(probed("C:/w", "ses_1", 5)).toBeUndefined();
  expect(h.calls.length).toBe(1);
  expect(await probeChat("C:/w", "ses_1", 5, 1000 + RETRY_AFTER_MS - 1)).toBeNull();
  expect(h.calls.length).toBe(1);
  h.mode = "now";
  expect(await probeChat("C:/w", "ses_1", 5, 1000 + RETRY_AFTER_MS)).toBe(true);
  expect(h.calls.length).toBe(2);
  // and a changed chat is not held back by the old failure
  h.mode = "fail";
  expect(await probeChat("C:/w", "ses_2", 5, 2000)).toBeNull();
  h.mode = "now";
  expect(await probeChat("C:/w", "ses_2", 6, 2001)).toBe(true);
});
