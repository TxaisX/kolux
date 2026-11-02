// The control tower (OD-09 / DT-C35, T-546): one always-on overview of every agent pane, what
// each is doing, what needs him, the plan usage per account, and the pane each row jumps to.
// Pure: the window hands in what it already computes for the Board (the chip and the meter of
// each pane) and this file only orders and groups it. Tested on its own.

import type { Chip, Lane } from "../board/chip";
import type { Meter, PlanFigures } from "../usage/meter";
import { accountKey, planOf } from "../usage/meter";
import { moveSelection } from "../inbox/inbox";
import type { Plan } from "../usage/plan";

/** One agent pane as the window sees it: its chip (null before any signal) and meter. */
export type Seat = {
  key: number;
  agent: string;
  title: string;
  branch: string | null;
  cwd: string | null;
  /** null = the provider's own sign-in; undefined = not known yet (a pane whose terminal has not answered), shown as the active account. */
  account?: string | null;
  chip: Chip | null;
  meter: Meter | null;
  /** When the state last moved; 0 when unknown. */
  since: number;
};

/** A row of the tower: the seat plus its lane and words; `jump` is the pane key to open. */
export type Row = Omit<Seat, "chip"> & { lane: Lane; word: string; line: string; file?: string; answer: boolean; jump: number };

/** Needs-you rows first, then working, then done; stopped and idle close the list (OD-09). */
export const ORDER: Lane[] = ["needs", "working", "done", "stopped", "idle"];

/** Rows in tower order; within a lane the newest change sits first. */
export function towerRows(seats: Seat[]): Row[] {
  const rank = (l: Lane) => ORDER.indexOf(l);
  const rows = seats.map(({ chip, ...s }): Row => ({ ...s, lane: chip?.lane ?? "idle", word: chip?.word ?? "Idle", line: chip?.line ?? "", file: chip?.file, answer: chip?.answer ?? false, jump: s.key }));
  return rows.sort((a, b) => rank(a.lane) - rank(b.lane) || b.since - a.since || a.key - b.key);
}

/** How many rows sit in each lane, in tower order. */
export function laneCounts(rows: Row[]): Array<{ lane: Lane; count: number }> {
  return ORDER.map((lane) => ({ lane, count: rows.filter((r) => r.lane === lane).length }));
}

/** One usage card per provider in use: its plan figures once, how many panes run under it, and the
 *  accounts those panes are on (in the order their panes appear) with a pane count each. */
export type AccountUsage = {
  agent: string;
  figures: PlanFigures | null;
  panes: number;
  accounts: Array<{ account: string | null; panes: number; /** T-548-b: this account's own figures (accounts other than the one the card's figures are for), when they have been read. */ figures?: PlanFigures }>;
  /** T-548, only when the active accounts were passed (T-548-b: on a Claude card too): the account the figures are read for (null = the system default). */
  forAccount?: string | null;
  /** T-548: panes of this provider on an account other than the one the figures are read for, whose own
   *  figures have not been read (a pane whose account is not known counts as being on the active one). */
  elsewhere?: number;
};
/** T-548: the account new panes use, per provider (null = the system default). */
export type ActiveAccounts = { claude: string | null; codex: string | null };

/** Providers in the order their panes appear; every provider seat counts, even before figures arrive.
 *  T-546-b (2): src/usage holds ONE Claude figure set and ONE Codex set (whichever account reported
 *  last), so a card per account would show the same figures under different names, a wrong number on
 *  the screen used to decide where work goes. Until T-548 reads one set per account, the figures sit
 *  on one card per provider and the accounts are listed under it with their pane counts. The name
 *  stays `usageByAccount` because the T-546 wiring in App.tsx imports it by that name. */
export function usageByAccount(seats: Pick<Seat, "agent" | "account">[], plan: Plan, active?: ActiveAccounts): AccountUsage[] {
  const out: AccountUsage[] = [];
  for (const s of seats) {
    if (s.agent !== "claude" && s.agent !== "codex") continue;
    // T-548-b: a pane whose account is not known (undefined) is on the active account, as before panes recorded one
    const account = s.account === undefined ? (active ? (s.agent === "claude" ? active.claude : active.codex) : null) : s.account;
    let card = out.find((u) => u.agent === s.agent);
    if (!card) out.push((card = { agent: s.agent, figures: planOf(s.agent, plan.claude, plan.codex), panes: 0, accounts: [] }));
    card.panes += 1;
    const acct = card.accounts.find((a) => a.account === account);
    if (acct) acct.panes += 1;
    else card.accounts.push({ account, panes: 1 });
  }
  if (!active) return out;
  // T-548: the figures on the card are the active account's. A card with no pane on that account has none to
  // show. T-548-b: Claude is read per account too (claudeBy), so both providers say whose figures they are and
  // an account the window has read figures for shows its own.
  for (const card of out) {
    const mine = card.agent === "claude" ? active.claude : active.codex;
    card.forAccount = mine;
    const others = card.accounts.filter((a) => a.account !== mine);
    // T-548-b: an account the window has read figures for shows its own
    for (const a of others) {
      const own = card.agent === "claude" ? planOf("claude", plan.claudeBy?.[accountKey(a.account)] ?? [], null) : planOf("codex", [], plan.codexBy?.[accountKey(a.account)] ?? null);
      if (own) a.figures = own;
    }
    card.elsewhere = others.filter((a) => !a.figures).reduce((n, a) => n + a.panes, 0);
    if (others.reduce((n, a) => n + a.panes, 0) === card.panes) card.figures = null;
  }
  return out;
}

/** FIX-5 (council P2 P12): what the list's selection becomes for a key: Up and Down walk the rows,
 * Home and End jump to the first and last. `null` = not a selection key (the page keeps it). */
export function selectionForKey(key: string, keys: number[], current: number | null): { to: number | null } | null {
  if (key === "ArrowDown" || key === "ArrowUp") return { to: moveSelection(keys, current, key === "ArrowDown" ? 1 : -1) };
  if (key === "Home") return { to: keys[0] ?? null };
  if (key === "End") return { to: keys[keys.length - 1] ?? null };
  return null;
}

/** FIX-1: the usage cards with account ids swapped for the names the switcher shows (the card's
 *  "figures for" line and its accounts list). Null stays null; the input is not changed. */
export function nameUsage(usage: AccountUsage[], label: (agent: string, id: string) => string): AccountUsage[] {
  const named = (agent: string, id: string | null) => (id === null ? null : label(agent, id));
  return usage.map((u) => ({ ...u, ...(u.forAccount === undefined ? {} : { forAccount: named(u.agent, u.forAccount) }), accounts: u.accounts.map((a) => ({ ...a, account: named(u.agent, a.account) })) }));
}

/** FIX-1: the seats with their account id swapped for its name, for the rows. */
export function nameSeats<T extends Pick<Seat, "agent" | "account">>(seats: T[], label: (agent: string, id: string) => string): T[] {
  return seats.map((s) => (s.account == null ? s : { ...s, account: label(s.agent, s.account) }));
}
