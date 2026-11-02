// T-645: the Insights figures, from in-memory fixtures only. Nothing here reads a real log or ~/.claude.
import { describe, expect, it } from "vitest";
import { estimate } from "../usage/pricing";
import { localDay, type Row, type Usage } from "../usage/tokens";
import { actionOf, anyTracked, chipOfLive, costKind, countedAt, dueForCount, folderOf, liveSessions, sessionsOf, totals, usageFor, type PaneLike } from "./model";

const NOW = new Date(2026, 10, 2, 12, 0, 0); // Mon 2 Nov 2026, local
const day = (back: number) => localDay(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - back));

const row = (r: Partial<Row>): Row => ({
  day: day(0), session: "s", model: "claude-sonnet-4-6", cwd: "C:\\Work\\alpha", band: 0,
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0, last: 1, ...r,
});
const saved = (rows: Row[]) => ({ scannedAt: 0, rows, error: null });

// Session A (claude): 1M input + 100k output today, and 2M input 20 days ago.
const a1 = row({ session: "A", day: day(0), input: 1_000_000, output: 100_000, last: 500 });
const a2 = row({ session: "A", day: day(20), input: 2_000_000, last: 100 });
// Session B (codex): 500k input + 50k output three days ago (inside the 7-day window).
const b1 = row({ session: "B", model: "gpt-5.4", cwd: "/home/x/beta", day: day(3), input: 500_000, output: 50_000, last: 400 });
const usage: Usage = { tracking: { claude: true, codex: true }, claude: saved([a1, a2]), codex: saved([b1]) };

describe("totals and sessions", () => {
  it("sums the cost of two sessions and splits it into today, 7 days and all time", () => {
    const costA = estimate("claude", [a1, a2]).usd;
    const costB = estimate("codex", [b1]).usd;
    expect(costA).toBeGreaterThan(0);
    expect(costB).toBeGreaterThan(0);
    const t = totals(usage, NOW);
    expect(t.all.usd).toBeCloseTo(costA + costB, 10);
    expect(t.all.tokens).toBe(1_100_000 + 2_000_000 + 550_000);
    expect(t.today.usd).toBeCloseTo(estimate("claude", [a1]).usd, 10);
    expect(t.today.tokens).toBe(1_100_000);
    expect(t.week.usd).toBeCloseTo(estimate("claude", [a1]).usd + costB, 10);
    expect(t.week.tokens).toBe(1_100_000 + 550_000);
    expect(t.all.partial).toBe(false);
  });

  it("the per-session lines add up to the all-time total", () => {
    const lines = sessionsOf(usage, 10);
    expect(lines.map((l) => l.session)).toEqual(["A", "B"]);
    expect(lines.reduce((n, l) => n + l.usd, 0)).toBeCloseTo(totals(usage, NOW).all.usd, 10);
    expect(lines[0]).toMatchObject({ provider: "claude", workspace: "alpha", tokens: 3_100_000 });
    expect(lines[1]).toMatchObject({ provider: "codex", workspace: "beta", tokens: 550_000 });
    expect(sessionsOf(usage, 1)).toHaveLength(1);
  });

  it("flags a model with no price as partial, and leaves an untracked provider out", () => {
    const odd = row({ session: "C", model: "mystery-9", input: 10 });
    const u: Usage = { tracking: { claude: true, codex: false }, claude: saved([odd]), codex: saved([b1]) };
    const t = totals(u, NOW);
    expect(t.all.partial).toBe(true);
    expect(t.all.tokens).toBe(10);
    expect(anyTracked(u)).toBe(true);
    expect(anyTracked({ tracking: { claude: false, codex: false }, claude: null, codex: null })).toBe(false);
    expect(totals({ tracking: { claude: false, codex: false }, claude: saved([a1]), codex: null }, NOW).all.tokens).toBe(0);
  });
});

describe("liveSessions", () => {
  const panes: PaneLike[] = [
    { key: 1, cwd: "C:\\Work\\alpha", agent: "claude", session: "A" },
    { key: 2, cwd: "/home/x/beta", agent: "codex" },
    { key: 3, cwd: "C:\\Work\\alpha", agent: "shell" },
    { key: 4, cwd: null, agent: "claude", kind: "browser" },
    { key: 5, cwd: "C:\\Work\\gamma\\", agent: "claude" },
    { key: 6, cwd: "C:\\Work\\delta", agent: "shell" }, // a shell that agentOf credits with an agent
  ];
  const agentOf = (p: PaneLike) => (p.key === 6 ? "claude" : p.agent);
  const states = { 1: "working", 2: "waiting", 5: "idle", 6: "working" } as const;
  const statusOf = (p: PaneLike) => states[p.key as keyof typeof states];

  it("leaves out shells and browser/editor tabs", () => {
    const out = liveSessions(panes, agentOf, statusOf, {}, {});
    expect(out.map((l) => l.key).sort()).toEqual([1, 2, 5, 6]);
  });

  it("sorts needs-you first, then working, then newest change", () => {
    const stamp = { 1: { at: 100 }, 2: { at: 50 }, 5: { at: 900 }, 6: { at: 300 } };
    const out = liveSessions(panes, agentOf, statusOf, {}, stamp, { 1: true, 2: true, 5: true, 6: true });
    expect(out.map((l) => l.key)).toEqual([2, 6, 1, 5]);
  });

  it("reads a pane the way the Tower does: exited, not started yet, quiet", () => {
    const run = { 1: false, 2: true, 6: true }; // 1 exited while its last hook said working; 5 has no process yet
    const out = liveSessions(panes, agentOf, (p) => (p.key === 2 ? undefined : statusOf(p)), {}, {}, run, { 6: true });
    const word = (k: number) => chipOfLive(out.find((l) => l.key === k)!, 0)?.word;
    expect(word(1)).toBe("Stopped");
    expect(chipOfLive(out.find((l) => l.key === 2)!, 0)?.lane).toBe("working"); // running, no hook yet
    expect(word(5)).toBe("Starting");
    expect(chipOfLive(out.find((l) => l.key === 6)!, 0)?.word).not.toBe("Working"); // stale: no recent update
    expect(out[out.length - 1].key).toBe(1); // the exited pane sorts after the live ones
  });

  it("leaves out a seat chooser pane", () => {
    expect(liveSessions([{ key: 9, cwd: null, agent: "claude", seats: [] }], (p) => p.agent, () => "working", {}, {})).toEqual([]);
  });

  it("builds workspace, action and time from the pane's signals", () => {
    const out = liveSessions(panes, agentOf, statusOf, { 1: { tool: "Bash", detail: "pnpm test" }, 2: { ask: "Which branch?\n\nWhich remote?" } }, { 1: { at: 42 } });
    const one = out.find((l) => l.key === 1)!;
    expect(one).toMatchObject({ agent: "claude", workspace: "alpha", dir: "C:\\Work\\alpha", session: "A", state: "working", action: "Bash: pnpm test", at: 42 });
    const two = out.find((l) => l.key === 2)!;
    expect(two).toMatchObject({ workspace: "beta", action: "Which branch? · Which remote?", at: null, session: null });
    expect(out.find((l) => l.key === 5)).toMatchObject({ workspace: "gamma", action: "" });
  });

  it("describes an action in plain words", () => {
    expect(actionOf(undefined)).toBe("");
    expect(actionOf({ tool: "Read" })).toBe("Read");
    expect(actionOf({ detail: "only detail" })).toBe("only detail");
    expect(actionOf({ tool: "Edit", detail: "x".repeat(200) })).toHaveLength(80);
    expect(folderOf("")).toBe("");
    expect(folderOf("C:\\a\\b\\")).toBe("b");
  });
});

describe("joining a live pane to its usage", () => {
  it("gives a pane the tokens and cost of the session id it carries", () => {
    const lines = sessionsOf(usage, 10);
    const [live] = liveSessions([{ key: 1, cwd: "C:\\Work\\alpha", agent: "claude", session: "A" }], (p) => p.agent, () => "working", {}, {});
    const hit = usageFor(live, lines)!;
    expect(hit.tokens).toBe(3_100_000);
    expect(hit.usd).toBeCloseTo(estimate("claude", [a1, a2]).usd, 10);
  });

  it("gives null when the pane has no session id or the session is unknown", () => {
    const lines = sessionsOf(usage, 10);
    expect(usageFor({ session: null }, lines)).toBeNull();
    expect(usageFor({ session: "nope" }, lines)).toBeNull();
  });
});

describe("costKind", () => {
  it("shows a dash for an unpriced cost, a floor for a partial one", () => {
    expect(costKind(0, true, 10)).toBe("none");
    expect(costKind(1.5, true, 10)).toBe("partial");
    expect(costKind(1.5, false, 10)).toBe("exact");
    expect(costKind(0, false, 0)).toBe("exact");
    expect(costKind(0, true, 0)).toBe("exact"); // no tokens: "$0.00", never "at least" or a dash
  });
});

describe("how old the count is", () => {
  const u = (claude: number | null, codex: number | null, track = { claude: true, codex: true }): Usage => ({
    tracking: track,
    claude: claude === null ? null : { scannedAt: claude, rows: [], error: null },
    codex: codex === null ? null : { scannedAt: codex, rows: [], error: null },
  });
  it("reports the oldest tracked count", () => {
    expect(countedAt(u(5_000, 9_000))).toBe(5_000);
    expect(countedAt(u(5_000, 9_000, { claude: false, codex: true }))).toBe(9_000);
    expect(countedAt(u(null, null))).toBeNull();
  });
  it("asks for a recount of tracked providers that are missing or too old", () => {
    expect(dueForCount(u(1_000, 9_000), 10_000, 5_000)).toEqual(["claude"]);
    expect(dueForCount(u(null, 9_000), 10_000, 5_000)).toEqual(["claude"]);
    expect(dueForCount(u(1_000, 1_000, { claude: false, codex: false }), 10_000, 5_000)).toEqual([]);
  });
  it("ignores a failed scan: no '0 ms epoch' count time, no rescan on every refresh", () => {
    const failed: Usage = { ...u(9_000, null), codex: { scannedAt: 0, rows: [], error: "no sessions folder" } };
    expect(countedAt(failed)).toBe(9_000);
    expect(dueForCount(failed, 10_000, 5_000)).toEqual([]);
  });
});
