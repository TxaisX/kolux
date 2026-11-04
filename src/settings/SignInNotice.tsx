// ACCT-012: a lapsed sign-in is flagged in the main window, outside Settings, with Sign in again.
// Only for the active managed Claude account once it is stale (and only while Kolux, not Claude
// Code, looks after sign-ins, ACCT-006; the 1-year key, when connected, is what panes use), or a
// managed Codex account that hit a sign-in error or whose sign-in file is gone. Codex's system-default
// login never raises it.
// Nothing shows until both account lists have loaded, so it never flickers at startup.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AccountsView } from "./ClaudeAccounts";
import type { CodexView } from "./CodexCard";
import { startCodexSignInScan } from "./codexSignInScan";

export type Lapsed = { agent: "claude" | "codex"; id: string; label: string; busy: boolean };

export function lapsed(claude: AccountsView | null, codex: CodexView | null): Lapsed | null {
  if (!claude || !codex) return null;
  if (!claude.upkeepLeftToClaude && !claude.keyMode) {
    const a = claude.accounts.find((a) => a.id === claude.active && a.stale);
    if (a) return { agent: "claude", id: a.id, label: `Claude account ${a.email ?? a.id}`, busy: claude.signingIn !== null };
  }
  const c = codex.accounts.find((a) => a.signInError || codex.missing.includes(a.id));
  if (c) return { agent: "codex", id: c.id, label: `Codex account ${c.email ?? c.id}`, busy: codex.signingIn !== null };
  return null;
}

export function SignInNoticeView({ lapsed: l, onSignIn, error = null }: { lapsed: Lapsed | null; onSignIn: (l: Lapsed) => void; error?: string | null }) {
  if (!l) return null;
  return (
    <div className="notice signin-notice" role="status" data-agent={l.agent}>
      <span>{l.label} is no longer signed in.</span>
      <button className="btn" disabled={l.busy} onClick={() => onSignIn(l)}>
        {l.busy ? "Signing in…" : "Sign in again"}
      </button>
      {error && (
        <span className="warn" role="alert" data-signin-error>
          {error}
        </span>
      )}
    </div>
  );
}

export default function SignInNotice() {
  const [claude, setClaude] = useState<AccountsView | null>(null);
  const [codex, setCodex] = useState<CodexView | null>(null);
  useEffect(() => {
    const readClaude = () => void invoke<AccountsView>("claude_accounts").then(setClaude).catch(() => {});
    const readCodex = () => void invoke<CodexView>("codex_accounts").then(setCodex).catch(() => {});
    readClaude();
    readCodex();
    // Asks Claude Code once at start whether the active account is still signed in.
    invoke("claude_account_check").catch(() => {});
    const offs = [listen("claude-accounts", readClaude), listen("codex-accounts", readCodex), listen("settings-saved", readClaude)];
    // T-139-d: a sign-in error Codex prints in a pane flags its account (the codex-accounts event re-reads it).
    const stopScan = startCodexSignInScan();
    return () => {
      stopScan();
      offs.forEach((o) => void o.then((u) => u()).catch(() => {}));
    };
  }, []);
  // The error belongs to the account whose sign-in failed to start (a Claude and a Codex account can share an id):
  // another lapsed account does not show it, and it goes when the lapsed account changes.
  const [error, setError] = useState<{ key: string; text: string } | null>(null);
  const signIn = (l: Lapsed) => {
    setError(null);
    const call = l.agent === "claude" ? invoke("claude_account_sign_in", { id: l.id }) : invoke("codex_account_sign_in", { device: false, again: l.id });
    call.catch((e) => setError({ key: `${l.agent}:${l.id}`, text: `Sign-in did not start: ${String(e)}` }));
  };
  const now = lapsed(claude, codex);
  useEffect(() => setError(null), [now?.agent, now?.id]);
  return <SignInNoticeView lapsed={now} onSignIn={signIn} error={error && error.key === (now && `${now.agent}:${now.id}`) ? error.text : null} />;
}
