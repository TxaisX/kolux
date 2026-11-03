// The Claude accounts section of Settings > AI connections (ACCT-005): each managed account
// signs in through the browser into its own private Claude folder and is listed with its email
// and organisation; one can be made active for new Claude panes. While the 1-year key (ACCT-004)
// is connected it wins for new panes, and the section says so. T-138 (ACCT-016..018): a System
// default row comes first; clicking a row picks the account for new Claude panes (panes already
// running keep theirs); Remove asks first and hands back to the system default.
// The upkeep switch (ACCT-006, on by default under OD-01) leaves sign-in upkeep to Claude Code;
// off, Kolux asks Claude Code whether the active account is still signed in (ACCT-012) and shows
// the lapsed warnings. Kolux never renews a sign-in itself (DT-C16).
import { useCallback, useEffect, useState } from "react";
import { saveChanged } from "./saveChanged";
import { AccountRow, AccountsReadError, signedInAt } from "./AccountRow";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AttentionNote, fixDoes, openInstallPage, type Attention } from "./Attention";
import { liveCheck } from "./ConnectGrid";

export type Account = { id: string; email: string | null; organization: string | null; configDir: string; lastSignIn: number; stale: boolean };
export type AccountsView = {
  accounts: Account[];
  active: string | null;
  signingIn: string | null;
  inBrowser: boolean;
  attention: Attention | null;
  keyMode: boolean;
  upkeepLeftToClaude: boolean;
};

export type AccountAction = { kind: "add" } | { kind: "again"; id: string } | { kind: "activate"; id: string | null } | { kind: "ask-remove"; id: string } | { kind: "remove"; id: string } | { kind: "keep" } | { kind: "cancel" } | { kind: "key" } | { kind: "install" } | { kind: "upkeep"; on: boolean };

/** Settings field of the upkeep switch: absent or true = Claude Code looks after sign-ins. */
export const UPKEEP_FIELD = "claudeSignInUpkeepByClaudeCode";

export function ClaudeAccountsView({ view, error, confirming = null, onAction }: { view: AccountsView | null; error?: string | null; confirming?: string | null; onAction: (a: AccountAction) => void }) {
  if (!view) return null;
  const busy = view.signingIn !== null;
  return (
    <section className="conn-card" aria-label="Claude accounts">
      <header className="conn-head">
        <span className="conn-name">Claude accounts</span>
        {!busy && (
          <button className="btn conn-add" onClick={() => onAction({ kind: "add" })}>
            Add Account
          </button>
        )}
      </header>
      {busy && (
        <div className="acct-pending" role="status">
          <span>{view.inBrowser ? "Finish signing in in the browser." : "Starting Claude Code's sign-in…"}</span>
          <button className="btn" onClick={() => onAction({ kind: "cancel" })}>
            Cancel
          </button>
        </div>
      )}
      <div className="acct-list">
        <AccountRow
          title="System default"
          detail="Claude Code's own login, as you signed in outside Kolux"
          active={view.active === null}
          busy={busy}
          onPick={() => onAction({ kind: "activate", id: null })}
        />
        {view.accounts.map((a) => (
          <AccountRow
            key={a.id}
            title={a.email ?? "Claude account"}
            detail={`${a.organization ?? "No organisation"} · Last signed in ${signedInAt(a.lastSignIn)}`}
            active={view.active === a.id}
            busy={busy}
            trouble={a.stale && !view.upkeepLeftToClaude ? "Needs re-auth" : null}
            onPick={() => onAction({ kind: "activate", id: a.id })}
            manage={{
              againLabel: "Re-authenticate",
              onAgain: () => onAction({ kind: "again", id: a.id }),
              confirming: confirming === a.id,
              activeGoes: view.active === a.id,
              onAsk: () => onAction({ kind: "ask-remove", id: a.id }),
              onRemove: () => onAction({ kind: "remove", id: a.id }),
              onKeep: () => onAction({ kind: "keep" }),
            }}
          />
        ))}
      </div>
      {view.accounts.length === 0 && !busy && <p className="conn-detail">Kolux is using the system-default login. No managed accounts yet: add one to run Claude panes on a Claude account of its own.</p>}
      {view.keyMode && view.active && <p className="conn-detail">The 1-year key is connected, so new Claude panes use the key. Disconnect it to run them on the active account.</p>}
      <AttentionNote
        attention={view.attention}
        route="claude-account"
        busy={busy}
        onFix={(f) => onAction({ kind: ({ key: "key", "install-page": "install", check: "cancel", connect: "add" } as const)[fixDoes(f)] })}
      />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
      {view.accounts.length > 0 && (
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={view.upkeepLeftToClaude} disabled={busy} onChange={(e) => onAction({ kind: "upkeep", on: e.target.checked })} />
          <span>
            Leave sign-in upkeep to Claude Code
            <small>
              {view.upkeepLeftToClaude
                ? "On unless you turn it off. Claude Code keeps these sign-ins fresh in its own panes; Kolux sends nothing to Anthropic's sign-in service and shows no sign-in warnings."
                : "Kolux asks Claude Code whether the active account is still signed in, at start and when you switch this off, and flags one that has lapsed here and in the main window. Kolux still sends nothing to Anthropic's sign-in service."}
            </small>
          </span>
        </label>
      )}
    </section>
  );
}

/** Writes the upkeep switch; switching it off asks Claude Code at once whether the active account is still signed in. */
function setUpkeep(on: boolean): Promise<void> {
  return invoke<Record<string, unknown>>("get_settings")
    .then((s) => saveChanged(s, { ...s, [UPKEEP_FIELD]: on }))
    .then(() => (on ? undefined : invoke<void>("claude_account_check")));
}

/** Starts a sign-in for a new account; the Claude card's "Use my Claude account instead". */
export function addClaudeAccount(): Promise<void> {
  return invoke("claude_account_sign_in", { id: null });
}

export default function ClaudeAccounts() {
  const [view, setView] = useState<AccountsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<AccountsView>("claude_accounts")
      .then(setView)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    read();
    let stop = () => {};
    listen("claude-accounts", read)
      .then((un) => (stop = un))
      .catch(() => {});
    // ACCT-014: re-read when Kolux is back in front or Check again is pressed (no timer: the
    // per-account check starts a program per account, so it stays on its own schedule).
    const off = liveCheck(read, window, document, 0);
    return () => (stop(), off());
  }, [read]);
  const act = (a: AccountAction) => {
    setError(null);
    setConfirming(a.kind === "ask-remove" ? a.id : null);
    if (a.kind === "ask-remove" || a.kind === "keep") return;
    const call =
      a.kind === "add"
        ? addClaudeAccount()
        : a.kind === "again"
          ? invoke("claude_account_sign_in", { id: a.id })
          : a.kind === "activate"
            ? invoke("claude_account_activate", { id: a.id })
            : a.kind === "remove"
              ? invoke("claude_account_remove", { id: a.id })
            : a.kind === "key"
              ? invoke("claude_key_connect")
              : a.kind === "install"
                ? openInstallPage("claude")
                : a.kind === "upkeep"
                  ? setUpkeep(a.on)
                  : invoke("claude_account_cancel");
    call.catch((e) => setError(String(e))).finally(read);
  };
  if (!view && error) return <AccountsReadError name="Claude" error={error} onRetry={() => (setError(null), read())} />;
  return <ClaudeAccountsView view={view} error={error} confirming={confirming} onAction={act} />;
}
