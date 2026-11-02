import { describe, expect, it } from "vitest";
import { laneCounts, nameSeats, nameUsage, selectionForKey, towerRows, usageByAccount, type Seat } from "./tower";
import type { Chip } from "../board/chip";

const chip = (lane: Chip["lane"], word: string = lane, line = "", file?: string): Chip => ({ lane, word, line, file, answer: lane === "needs" });
const seat = (key: number, chip: Chip | null, since = 0, extra: Partial<Seat> = {}): Seat => ({ key, agent: "claude", title: `pane ${key}`, branch: null, cwd: null, account: null, chip, meter: null, since, ...extra });

describe("towerRows", () => {
  it("orders needs-you first, then working, then done, then stopped and idle", () => {
    const rows = towerRows([seat(1, chip("done")), seat(2, chip("idle")), seat(3, chip("working")), seat(4, chip("stopped")), seat(5, chip("needs"))]);
    expect(rows.map((r) => r.lane)).toEqual(["needs", "working", "done", "stopped", "idle"]);
  });

  it("puts the newest change first inside a lane and keeps the pane order for ties", () => {
    const rows = towerRows([seat(1, chip("working"), 10), seat(2, chip("working"), 30), seat(3, chip("working"), 30), seat(4, chip("working"), 20)]);
    expect(rows.map((r) => r.key)).toEqual([2, 3, 4, 1]);
  });

  it("carries the chip's words and file and jumps to the pane's own key", () => {
    const [row] = towerRows([seat(7, chip("needs", "Needs you", "Bash: npm test"), 5, { title: "fix tests", branch: "agent-a" })]);
    expect(row).toMatchObject({ key: 7, jump: 7, lane: "needs", word: "Needs you", line: "Bash: npm test", answer: true, title: "fix tests", branch: "agent-a" });
    const [done] = towerRows([seat(8, chip("done", "Done", "handed off", "src/a.ts"))]);
    expect(done.file).toBe("src/a.ts");
  });

  it("reads a pane with no signal yet as idle", () => {
    expect(towerRows([seat(1, null)])[0]).toMatchObject({ lane: "idle", word: "Idle", line: "", answer: false });
  });

  it("counts every lane in tower order", () => {
    const rows = towerRows([seat(1, chip("needs")), seat(2, chip("needs")), seat(3, chip("working"))]);
    expect(laneCounts(rows)).toEqual([
      { lane: "needs", count: 2 },
      { lane: "working", count: 1 },
      { lane: "done", count: 0 },
      { lane: "stopped", count: 0 },
      { lane: "idle", count: 0 },
    ]);
  });
});

describe("usageByAccount", () => {
  const plan = {
    claude: [
      { kind: "five_hour", usedPercent: 42, resetsAt: null },
      { kind: "seven_day", usedPercent: 17, resetsAt: null },
    ],
    codex: { state: "ok" as const, fiveHour: { usedPercent: 5, resetsAt: null, windowMins: 300 }, weekly: { usedPercent: 60, resetsAt: null, windowMins: null }, resetCredits: null, plan: null, message: null },
  };

  // T-546-b (2): src/usage holds ONE figure set per provider, so two Claude accounts never get two
  // cards carrying the same figures under different names; one card per provider lists the accounts.
  it("gives one card per provider with its figures once and the pane count per account under it", () => {
    const seats = [
      { agent: "claude", account: "work" },
      { agent: "claude", account: "personal" },
      { agent: "claude", account: "work" },
      { agent: "claude", account: null },
      { agent: "codex", account: null },
      { agent: "shell", account: null },
    ];
    expect(usageByAccount(seats, plan)).toEqual([
      { agent: "claude", figures: { fiveHour: 42, weekly: 17 }, panes: 4, accounts: [{ account: "work", panes: 2 }, { account: "personal", panes: 1 }, { account: null, panes: 1 }] },
      { agent: "codex", figures: { fiveHour: 5, weekly: 60 }, panes: 1, accounts: [{ account: null, panes: 1 }] },
    ]);
  });

  it("never repeats a provider's figures: two Claude accounts share one card", () => {
    const cards = usageByAccount([{ agent: "claude", account: "work" }, { agent: "claude", account: "personal" }], plan);
    expect(cards).toHaveLength(1);
    expect(cards[0].accounts.map((a) => a.account)).toEqual(["work", "personal"]);
    expect(cards.filter((c) => c.figures?.fiveHour === 42)).toHaveLength(1);
  });

  it("keeps a provider whose figures have not arrived, with null figures", () => {
    expect(usageByAccount([{ agent: "codex", account: "b" }], { claude: [], codex: null })).toEqual([{ agent: "codex", figures: null, panes: 1, accounts: [{ account: "b", panes: 1 }] }]);
  });
});

// T-548 (council AFTER, MERGE 42): with the active accounts known, a card says whose figures it shows and a
// Codex pane on another account is not counted under the active account's figures.
describe("usageByAccount with the active accounts", () => {
  const plan = {
    claude: [{ kind: "five_hour", usedPercent: 42, resetsAt: null }],
    codex: { state: "ok" as const, fiveHour: { usedPercent: 5, resetsAt: null, windowMins: 300 }, weekly: null, resetCredits: null, plan: null, message: null },
  };

  // T-548-b (was FIX-1): the Claude windows are read per account now, so a Claude card says whose figures it shows,
  // like a Codex card, and a pane on another account is not counted under them.
  it("says which Claude account the card's figures are for and counts the panes on other accounts as elsewhere", () => {
    const [card] = usageByAccount([{ agent: "claude", account: "work" }, { agent: "claude", account: null }], plan, { claude: "work", codex: null });
    expect(card.forAccount).toBe("work");
    expect(card.figures).toEqual({ fiveHour: 42, weekly: null });
    expect(card.elsewhere).toBe(1);
  });

  it("shows no Claude figures when every Claude pane is on another account than the active one", () => {
    const [card] = usageByAccount([{ agent: "claude", account: null }], plan, { claude: "work", codex: null });
    expect(card.figures).toBeNull();
    expect(card.elsewhere).toBe(1);
  });

  it("shows Codex figures when a pane runs on the active account and counts the others as elsewhere", () => {
    const seats = [{ agent: "codex", account: "a" }, { agent: "codex", account: "b" }, { agent: "codex", account: null }];
    const [card] = usageByAccount(seats, plan, { claude: null, codex: "a" });
    expect(card.figures).toEqual({ fiveHour: 5, weekly: null });
    expect(card.forAccount).toBe("a");
    expect(card.elsewhere).toBe(2);
  });

  it("shows no Codex figures when every pane is on another account than the active one", () => {
    const [card] = usageByAccount([{ agent: "codex", account: "b" }, { agent: "codex", account: "c" }], plan, { claude: null, codex: "a" });
    expect(card.figures).toBeNull();
    expect(card.elsewhere).toBe(2);
    expect(card.panes).toBe(2);
  });

  it("treats the system default (null) as the active account when none is chosen", () => {
    const [card] = usageByAccount([{ agent: "codex", account: null }], plan, { claude: null, codex: null });
    expect(card.figures).toEqual({ fiveHour: 5, weekly: null });
    expect(card.elsewhere).toBe(0);
    expect(card.forAccount).toBeNull();
  });
});

// FIX-1 (council d2 stand-in review, FIX-SOON 1): the card and the rows hold account ids; what the person reads is the label.
describe("FIX-1 account labels on the Tower", () => {
  const labels: Record<string, string> = { "codex:7f3a9c": "Team", "claude:c-91": "work@example.com" };
  const label = (agent: string, id: string) => labels[`${agent}:${id}`] ?? id;
  const plan = { claude: [], codex: { state: "ok" as const, fiveHour: { usedPercent: 5, resetsAt: null, windowMins: 300 }, weekly: null, resetCredits: null, plan: null, message: null } };

  it("swaps the ids on a usage card (the figures-for line and the accounts list) for their labels, leaving null and unknown ids", () => {
    const cards = usageByAccount([{ agent: "codex", account: "7f3a9c" }, { agent: "codex", account: null }, { agent: "claude", account: "c-91" }, { agent: "codex", account: "gone" }], plan, { claude: "c-91", codex: "7f3a9c" });
    const named = nameUsage(cards, label);
    const codex = named.find((c) => c.agent === "codex")!;
    expect(codex.forAccount).toBe("Team");
    expect(codex.accounts.map((a) => a.account)).toEqual(["Team", null, "gone"]);
    expect(named.find((c) => c.agent === "claude")!.accounts.map((a) => a.account)).toEqual(["work@example.com"]);
    // the input is not changed (the window keeps the ids for the active-account comparison)
    expect(cards.find((c) => c.agent === "codex")!.forAccount).toBe("7f3a9c");
  });

  it("keeps a null forAccount (system default) null and an unset one unset", () => {
    const [codex] = nameUsage(usageByAccount([{ agent: "codex", account: null }], plan, { claude: null, codex: null }), label);
    expect(codex.forAccount).toBeNull();
    const [claude] = nameUsage(usageByAccount([{ agent: "claude", account: null }], plan, { claude: null, codex: null }), label);
    expect(claude.forAccount).toBeNull();
    const [named] = nameUsage(usageByAccount([{ agent: "claude", account: "c-91" }], plan, { claude: "c-91", codex: null }), label);
    expect(named.forAccount).toBe("work@example.com");
  });

  it("labels the account on each row's seat, per provider", () => {
    const seats = [seat(1, null, 0, { agent: "codex", account: "7f3a9c" }), seat(2, null, 0, { agent: "claude", account: "c-91" }), seat(3, null, 0, { account: null })];
    expect(nameSeats(seats, label).map((s) => s.account)).toEqual(["Team", "work@example.com", null]);
    expect(seats[0].account).toBe("7f3a9c");
  });
});

// FIX-5 (council P2 P12): the list's keys: Up and Down walk, Home and End jump to the ends, any other key is left alone.
describe("FIX-5 the Tower list keys", () => {
  const keys = [4, 7, 9];
  it("walks with the arrows, stopping at the ends", () => {
    expect(selectionForKey("ArrowDown", keys, 4)).toEqual({ to: 7 });
    expect(selectionForKey("ArrowDown", keys, 9)).toEqual({ to: 9 });
    expect(selectionForKey("ArrowUp", keys, 7)).toEqual({ to: 4 });
    expect(selectionForKey("ArrowDown", keys, null)).toEqual({ to: 4 });
  });

  it("Home goes to the first row and End to the last, from anywhere", () => {
    expect(selectionForKey("Home", keys, 7)).toEqual({ to: 4 });
    expect(selectionForKey("End", keys, null)).toEqual({ to: 9 });
    expect(selectionForKey("End", [], null)).toEqual({ to: null });
  });

  it("leaves every other key to the page", () => {
    expect(selectionForKey("a", keys, 4)).toBeNull();
    expect(selectionForKey("Enter", keys, 4)).toBeNull();
  });
});

// T-548-b: figures read for a Codex account other than the active one show on its own line.
describe("usageByAccount with per-account Codex figures", () => {
  const ok = (five: number) => ({ state: "ok" as const, fiveHour: { usedPercent: five, resetsAt: null, windowMins: 300 }, weekly: null, resetCredits: null, plan: null, message: null });
  const plan = { claude: [], codex: ok(5), codexBy: { b: ok(70), "": ok(33) } };
  const active = { claude: null, codex: "a" };

  it("gives an account whose figures were read its own, and counts only the unread ones as elsewhere", () => {
    const seats = [{ agent: "codex", account: "a" }, { agent: "codex", account: "b" }, { agent: "codex", account: null }, { agent: "codex", account: "c" }];
    const [card] = usageByAccount(seats, plan, active);
    expect(card.figures).toEqual({ fiveHour: 5, weekly: null });
    expect(card.accounts.find((a) => a.account === "b")?.figures).toEqual({ fiveHour: 70, weekly: null });
    expect(card.accounts.find((a) => a.account === null)?.figures).toEqual({ fiveHour: 33, weekly: null });
    expect(card.accounts.find((a) => a.account === "a")?.figures).toBeUndefined();
    expect(card.accounts.find((a) => a.account === "c")?.figures).toBeUndefined();
    expect(card.elsewhere).toBe(1);
  });

  it("still drops the card's own figures when no pane runs on the active account, but keeps each account's", () => {
    const [card] = usageByAccount([{ agent: "codex", account: "b" }], plan, active);
    expect(card.figures).toBeNull();
    expect(card.accounts[0].figures).toEqual({ fiveHour: 70, weekly: null });
    expect(card.elsewhere).toBe(0);
  });

  it("leaves a Claude card without a Codex account's figures", () => {
    const [card] = usageByAccount([{ agent: "claude", account: "b" }], plan, active);
    expect(card.accounts[0].figures).toBeUndefined();
  });
});

// T-548-b: windows read for a Claude account other than the active one show on its own line, like Codex's.
describe("usageByAccount with per-account Claude windows", () => {
  const win = (five: number, week: number | null) => [{ kind: "five_hour", usedPercent: five, resetsAt: null }, ...(week === null ? [] : [{ kind: "seven_day", usedPercent: week, resetsAt: null }])];
  const plan = { claude: win(5, 6), codex: null, claudeBy: { b: win(70, 20), "": win(33, null) } };
  const active = { claude: "a", codex: null };

  it("gives a Claude account whose windows were read its own 5-hour and Weekly, and counts only the unread ones as elsewhere", () => {
    const seats = [{ agent: "claude", account: "a" }, { agent: "claude", account: "b" }, { agent: "claude", account: null }, { agent: "claude", account: "c" }];
    const [card] = usageByAccount(seats, plan, active);
    expect(card.forAccount).toBe("a");
    expect(card.figures).toEqual({ fiveHour: 5, weekly: 6 });
    expect(card.accounts.find((a) => a.account === "b")?.figures).toEqual({ fiveHour: 70, weekly: 20 });
    expect(card.accounts.find((a) => a.account === null)?.figures).toEqual({ fiveHour: 33, weekly: null });
    expect(card.accounts.find((a) => a.account === "a")?.figures).toBeUndefined();
    expect(card.accounts.find((a) => a.account === "c")?.figures).toBeUndefined();
    expect(card.elsewhere).toBe(1);
  });

  it("drops the card's own figures when no pane runs on the active account, but keeps each account's; it is not 'elsewhere'", () => {
    const [card] = usageByAccount([{ agent: "claude", account: "b" }], plan, active);
    expect(card.figures).toBeNull();
    expect(card.accounts[0].figures).toEqual({ fiveHour: 70, weekly: 20 });
    expect(card.elsewhere).toBe(0);
  });
});
