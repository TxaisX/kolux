// The Codex accounts section under Manage accounts (advanced) on Settings > AI connections
// (ACCT-001, ACCT-019, T-138-c), beside the Claude accounts section. A System default row reports
// Codex's own login as it is, re-read whenever Kolux gets focus (ACCT-020); managed rows can be
// picked, named, re-signed or removed. The user names accounts, and two on one email ask to be
// named, since OpenAI does not document where a sign-in says personal or business (T-138-b).
// The Codex card above and this section read the same backend view; each change Kolux makes
// emits codex-accounts, so both follow it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLeaveSave } from "./leave";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AccountRow, AccountsReadError, signedInAt } from "./AccountRow";
import { liveCheck } from "./ConnectGrid";
import type { CodexAccount, CodexView } from "./CodexCard";

const NAME_MAX = 40;
export type CodexListAction = { kind: "add" } | { kind: "activate"; id: string | null } | { kind: "ask-remove"; id: string } | { kind: "remove"; id: string } | { kind: "keep" } | { kind: "name"; id: string } | { kind: "label"; id: string; label: string } | { kind: "again"; id: string };

const systemRow: Record<CodexView["systemDefault"], string> = {
  chatgpt: "Signed in with ChatGPT",
  "api-key": "Running on an API key",
  "custom-provider": "Running on an API key with a custom provider",
  "signed-out": "Signed out",
};

export const who = (a: CodexAccount) => a.email ?? "ChatGPT account";
/** ACCT-019: another listed account signs in with the same email. */
export const sharesEmail = (v: CodexView, a: CodexAccount) => !!a.email && v.accounts.some((b) => b.id !== a.id && b.email?.toLowerCase() === a.email?.toLowerCase());

/** SET-030: what is wrong with one account, if anything. */
export function codexTrouble(v: CodexView, a: CodexAccount): string | null {
  if (v.missing.includes(a.id)) return "Needs sign-in";
  if (a.signInError) return "Needs re-auth";
  if (v.drifted.includes(a.id)) return "Settings changed";
  return null;
}

export function CodexAccountsView({ view, error, confirming = null, naming = null, onAction }: { view: CodexView | null; error?: string | null; confirming?: string | null; naming?: string | null; onAction: (a: CodexListAction) => void }) {
  if (!view) return null;
  const busy = view.signingIn !== null;
  return (
    <section className="conn-card" aria-label="Codex accounts">
      <header className="conn-head">
        <span className="conn-name">Codex accounts</span>
        {!busy && (
          <button className="btn conn-add" onClick={() => onAction({ kind: "add" })}>
            Add Account
          </button>
        )}
      </header>
      {busy && (
        <p className="conn-detail" role="status">
          Signing in on the Codex card above.
        </p>
      )}
      <div className="acct-list">
        <AccountRow
          title="System default"
          detail={`Codex's own login · ${systemRow[view.systemDefault]}`}
          active={view.active === null}
          busy={busy}
          onPick={() => onAction({ kind: "activate", id: null })}
        />
        {view.accounts.map((a) => (
          <AccountRow
            key={a.id}
            title={a.label ? `${a.label} · ${who(a)}` : who(a)}
            detail={!a.label && sharesEmail(view, a) ? "Same email as another account: name it, e.g. Work" : `Last signed in ${signedInAt(a.lastSignIn)}`}
            active={view.active === a.id}
            busy={busy}
            trouble={codexTrouble(view, a)}
            onPick={() => onAction({ kind: "activate", id: a.id })}
            manage={{
              againLabel: codexTrouble(view, a) ? "Sign in again" : null,
              onAgain: () => onAction({ kind: "again", id: a.id }),
              confirming: confirming === a.id,
              activeGoes: view.active === a.id,
              onAsk: () => onAction({ kind: "ask-remove", id: a.id }),
              onRemove: () => onAction({ kind: "remove", id: a.id }),
              onKeep: () => onAction({ kind: "keep" }),
              nameLabel: a.label ? "Rename" : "Name",
              onName: () => onAction({ kind: "name", id: a.id }),
            }}
            below={
              naming === a.id && (
                <NameInput id={a.id} who={who(a)} saved={a.label ?? ""} onAction={onAction} />
              )
            }
          />
        ))}
      </div>
      {view.accounts.length === 0 && !busy && <p className="conn-detail">Kolux is using Codex's own login. No managed accounts yet: add one to run Codex panes on a ChatGPT account of its own.</p>}
      {view.accounts.some((a) => view.drifted.includes(a.id)) && (
        <p className="conn-detail warn">Codex's settings file for a marked account was changed, so Codex may keep its sign-in where Kolux cannot see it. Sign in again puts Kolux's settings back.</p>
      )}
      {view.settingsWarning && <p className="conn-detail warn">{view.settingsWarning}</p>}
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** The account name box: Enter or leaving it saves; SET-036: so do changing page and closing the window; Escape keeps the old name. */
function NameInput({ id, who: name, saved, onAction }: { id: string; who: string; saved: string; onAction: (a: CodexListAction) => void }) {
  const typed = useRef(saved);
  const done = useRef(false);
  const label = (text: string) => {
    if (done.current) return;
    done.current = true;
    onAction({ kind: "label", id, label: text });
  };
  useLeaveSave(() => typed.current !== saved && label(typed.current));
  return (
    <input
      className="field acct-name"
      aria-label={`Name for ${name}`}
      placeholder="Personal, Work…"
      maxLength={NAME_MAX}
      defaultValue={saved}
      autoFocus
      onChange={(e) => (typed.current = e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          done.current = true;
          onAction({ kind: "keep" });
        }
      }}
      onBlur={(e) => label(e.currentTarget.value)}
    />
  );
}

export default function CodexAccounts() {
  const [view, setView] = useState<CodexView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<CodexView>("codex_accounts")
      .then(setView)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    read();
    let stop = () => {};
    listen("codex-accounts", read)
      .then((un) => (stop = un))
      .catch(() => {});
    // ACCT-020: a sign-out made in a plain terminal shows as soon as Kolux is back in front.
    const off = liveCheck(read, window, document, 0);
    return () => (stop(), off());
  }, [read]);
  const act = (a: CodexListAction) => {
    setError(null);
    setConfirming(a.kind === "ask-remove" ? a.id : null);
    setNaming(a.kind === "name" ? a.id : null);
    if (a.kind === "ask-remove" || a.kind === "keep" || a.kind === "name") return;
    const call =
      a.kind === "remove"
        ? invoke("codex_account_remove", { id: a.id })
        : a.kind === "activate"
          ? invoke("codex_account_activate", { id: a.id })
          : a.kind === "label"
            ? invoke("codex_account_label", { id: a.id, label: a.label })
            : invoke("codex_account_sign_in", { device: false, again: a.kind === "again" ? a.id : null });
    call.catch((e) => setError(String(e))).finally(read);
  };
  if (!view && error) return <AccountsReadError name="Codex" error={error} onRetry={() => (setError(null), read())} />;
  return <CodexAccountsView view={view} error={error} confirming={confirming} naming={naming} onAction={act} />;
}
