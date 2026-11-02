// ACCT-023 / ACCT-064: which Codex panes to ask after the active Codex account changed, and what
// to say. A pane remembers the account id it started on (`account`: null for Codex's own sign-in,
// undefined when it never ran Codex or its account is not known); accounts are told apart by id,
// never by label.

export type CodexAccount = { id: string; email?: string | null };

export type AccountPrompt =
  /** The active account is another one; the pane still runs on `from`. */
  | { kind: "changed"; from: string; to: string }
  /** The pane's account was removed; `to` is the active one to restart on, null when there is none. */
  | { kind: "removed"; to: string | null };

export function accountLabel(id: string | null, accounts: CodexAccount[]): string {
  if (id === null) return "Codex's own sign-in";
  return accounts.find((a) => a.id === id)?.email || `account ${id.slice(0, 8)}`;
}

/**
 * The prompt a pane shows, or null. Only a running Codex pane tied to an account is asked; `kept`
 * is the active account the user chose to keep this pane away from, so the same change asks once
 * and a further change asks again; back on the pane's own account there is nothing to ask.
 */
export function accountPrompt(pane: { agent: string; account?: string | null }, running: boolean, active: string | null, accounts: CodexAccount[], kept: string | null | undefined): AccountPrompt | null {
  if (pane.agent !== "codex" || !running || pane.account === undefined) return null;
  if (pane.account !== null && !accounts.some((a) => a.id === pane.account)) return { kind: "removed", to: active === null ? null : accountLabel(active, accounts) };
  if (pane.account === active || kept === active) return null;
  return { kind: "changed", from: accountLabel(pane.account, accounts), to: accountLabel(active, accounts) };
}

// T-139-d (ACCT-064): the Codex setup-change version of the restart prompt. A pane remembers the
// setup it started with (`setup`, a string from codexSetup); when the settings now give another one
// (the Codex command, arguments, variables, or the permissions mode) the pane is asked, once per
// change, the same way as for an account change.

/** The parts of the settings that decide how Codex is started, as one comparable string. */
export function codexSetup(settings: object): string {
  const s = settings as { agentPermissions?: unknown; agentOptions?: { codex?: { command?: unknown; args?: unknown; env?: unknown } } };
  const o = s.agentOptions?.codex ?? {};
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return JSON.stringify([s.agentPermissions === "manual" ? "manual" : "yolo", text(o.command), text(o.args), text(o.env)]);
}

/** Whether a running Codex pane that started on another setup should be asked; `kept` is the setup the
 *  user chose to keep this pane away from. A pane that never recorded its setup is not asked. */
export function setupChanged(pane: { agent: string; setup?: string }, running: boolean, now: string, kept: string | undefined): boolean {
  return pane.agent === "codex" && running && pane.setup !== undefined && pane.setup !== now && kept !== now;
}

/** T-548-b: what a pane remembers once its terminal answers which account it began on. A Codex pane keeps the
 *  account and the setup it began on (ACCT-023); a Claude pane keeps the account (null = Claude's own sign-in),
 *  so the plan figures it shows are its own account's rather than whoever is active. A shell remembers nothing.
 *  Null when the pane already holds exactly this. */
export function spawnRecord(pane: { agent: string; account?: string | null; setup?: string }, account: string | null, setup: string): { account: string | null; setup?: string } | null {
  if (pane.agent === "codex") return pane.account !== account || pane.setup !== setup ? { account, setup } : null;
  if (pane.agent === "claude") return pane.account !== account ? { account } : null;
  return null;
}
