// Owner change 2026-11-06: the workspace spend ribbon's figures, from in-memory rows only.
import { expect, test } from "vitest";
import { estimate } from "./pricing";
import { localDay, tokensOf, type Row, type Usage } from "./tokens";
import { dueForScan, workspaceName, workspaceSpend } from "./workspaceRibbon";

const TODAY = new Date(2026, 10, 6, 12, 0, 0); // Friday 6 Nov 2026, local
const day = (back: number) => localDay(new Date(2026, 10, 6 - back));
const row = (p: Partial<Row> = {}): Row => ({
  day: day(0), session: "s", model: "claude-opus-4-5", cwd: "C:\\Work\\alpha", band: 0,
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 1, ...p,
});
const saved = (rows: Row[], scannedAt = 1_760_000_000_000, error: string | null = null) => ({ scannedAt, rows, error });

// Session A today (1M in, 100k out), session B in a subfolder today, session C three days ago,
// session D five days ago, and session O twenty days ago. E is a sibling folder that must not count.
const a1 = row({ session: "A", input: 1_000_000, output: 100_000 });
const a2 = row({ session: "B", cwd: "C:\\Work\\alpha\\packages\\app", input: 200_000, output: 20_000 });
const a3 = row({ session: "C", day: day(3), input: 500_000 });
const a4 = row({ session: "D", day: day(5), model: "gpt-5.4", input: 300_000 });
const a0 = row({ session: "O", day: day(20), input: 2_000_000 });
const b1 = row({ session: "X", cwd: "C:\\Work\\beta", model: "gpt-5.4", input: 900_000 });
const sibling = row({ session: "Y", cwd: "C:\\Work\\alpha2", input: 7_000_000 });

const usage = (over: Partial<Usage> = {}): Usage => ({
  tracking: { claude: true, codex: true },
  claude: saved([a1, a2, a3, a0, sibling]),
  codex: saved([a4, b1]),
  ...over,
});

test("owner change 2026-11-06: the ribbon sums only the workspace and its subfolders, across providers", () => {
  const s = workspaceSpend(usage(), "C:\\Work\\alpha", TODAY);
  const expected = [a1, a2, a3, a0].reduce((n, r) => n + tokensOf(r), 0) + tokensOf(a4);
  expect(s.tracked).toBe(true);
  expect(s.dir).toBe("C:\\Work\\alpha");
  expect(s.all.tokens).toBe(expected);
  expect(s.all.usd).toBeCloseTo(estimate("claude", [a1, a2, a3, a0]).usd + estimate("codex", [a4]).usd, 10);
  expect(s.all.partial).toBe(false);
  // A sibling folder whose name starts with the workspace's is not inside it.
  expect(s.all.tokens).not.toBe(expected + tokensOf(sibling) + tokensOf(b1));
  expect(s.sessions).toBe(5);
});

test("owner change 2026-11-06: today and the last seven days split from all time", () => {
  const s = workspaceSpend(usage(), "C:\\Work\\alpha", TODAY);
  expect(s.today.tokens).toBe(tokensOf(a1) + tokensOf(a2));
  expect(s.today.usd).toBeCloseTo(estimate("claude", [a1, a2]).usd, 10);
  expect(s.week.tokens).toBe(tokensOf(a1) + tokensOf(a2) + tokensOf(a3) + tokensOf(a4));
  expect(s.week.usd).toBeCloseTo(estimate("claude", [a1, a2, a3]).usd + estimate("codex", [a4]).usd, 10);
});

test("owner change 2026-11-06: the gauge is the last 14 local days, oldest first, with today at the end", () => {
  const s = workspaceSpend(usage(), "C:\\Work\\alpha", TODAY);
  expect(s.days).toHaveLength(14);
  expect(s.days[0].day).toBe(day(13));
  expect(s.days[13].day).toBe(day(0));
  expect(s.days.find((d) => d.day === day(0))).toMatchObject({ tokens: tokensOf(a1) + tokensOf(a2) });
  expect(s.days.find((d) => d.day === day(3))?.tokens).toBe(tokensOf(a3));
  expect(s.days.find((d) => d.day === day(6))?.tokens).toBe(0);
  // Nothing older than the seven-day window falls inside the fourteen-day gauge.
  expect(s.days.reduce((n, d) => n + d.tokens, 0)).toBe(s.week.tokens);
});

test("owner change 2026-11-06: the provider lines add up and the largest is first", () => {
  const s = workspaceSpend(usage(), "C:\\Work\\alpha", TODAY);
  expect(s.providers.map((p) => p.provider)).toEqual(["claude", "codex"]);
  expect(s.providers[0].tokens).toBe([a1, a2, a3, a0].reduce((n, r) => n + tokensOf(r), 0));
  expect(s.providers[1].tokens).toBe(tokensOf(a4));
  expect(s.providers.reduce((n, p) => n + p.tokens, 0)).toBe(s.all.tokens);
});

test("owner change 2026-11-06: case, slashes and a trailing slash name the same workspace", () => {
  const s = workspaceSpend(usage(), "c:/work/ALPHA/", TODAY);
  expect(s.all.tokens).toBe(workspaceSpend(usage(), "C:\\Work\\alpha", TODAY).all.tokens);
  expect(workspaceName("C:\\Work\\alpha\\")).toBe("alpha");
  expect(workspaceName("c:/work/ALPHA")).toBe("ALPHA");
  expect(workspaceName(null)).toBe("");
});

test("owner change 2026-11-06: an untracked provider is left out, and an unpriced model makes the cost a floor", () => {
  const off = usage({ tracking: { claude: true, codex: false } });
  expect(workspaceSpend(off, "C:\\Work\\alpha", TODAY).all.tokens).toBe([a1, a2, a3, a0].reduce((n, r) => n + tokensOf(r), 0));
  const odd = row({ session: "Z", model: "mystery-9", input: 10 });
  const s = workspaceSpend(usage({ tracking: { claude: true, codex: false }, claude: saved([odd]), codex: null }), "C:\\Work\\alpha", TODAY);
  expect(s.all).toEqual({ tokens: 10, usd: 0, partial: true });
  expect(s.providers).toHaveLength(1);
  expect(s.providers[0].partial).toBe(true);
});

test("owner change 2026-11-06: a workspace with no recorded use reads zero, not missing", () => {
  const s = workspaceSpend(usage(), "C:\\Work\\gamma", TODAY);
  expect(s.tracked).toBe(true);
  expect(s.all).toEqual({ tokens: 0, usd: 0, partial: false });
  expect(s.today).toEqual({ tokens: 0, usd: 0, partial: false });
  expect(s.sessions).toBe(0);
  expect(s.providers).toEqual([]);
  expect(s.days).toHaveLength(14);
  expect(s.days.every((d) => d.tokens === 0)).toBe(true);
  expect(s.scannedAt).toBe(1_760_000_000_000);
});

test("owner change 2026-11-06: a missing or stale count is refreshed; a failed one is not retried every minute", () => {
  const now = 2_000_000_000_000;
  const u: Usage = {
    tracking: { claude: true, codex: true },
    claude: saved([], 0),
    codex: saved([], now),
  };
  expect(dueForScan(u, now, 300_000)).toEqual(["claude"]);
  expect(dueForScan({ ...u, tracking: { claude: true, codex: false } }, now, 300_000)).toEqual(["claude"]);
  expect(dueForScan({ ...u, claude: saved([], now - 600_000) }, now, 300_000)).toEqual(["claude"]);
  expect(dueForScan({ ...u, claude: saved([], now) }, now, 300_000)).toEqual([]);
  expect(dueForScan({ ...u, claude: saved([], 0, "no logs") }, now, 300_000)).toEqual([]);
  // A tracked provider with no count yet leaves the total incomplete, so no count time is claimed.
  expect(workspaceSpend(usage({ codex: null }), "C:\\Work\\alpha", TODAY).scannedAt).toBeNull();
  // A failed read keeps the last figures but carries why, so the ribbon can say the total may be short.
  expect(workspaceSpend(usage({ claude: saved([a1], 1_760_000_000_000, "denied") }), "C:\\Work\\alpha", TODAY).error).toBe("denied");
});
