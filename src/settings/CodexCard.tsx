// The Codex card on Settings > AI connections (ACCT-007): Connect signs a ChatGPT account in
// through the browser, "Sign in with a code" shows a link and a one-time code to enter on any
// device. Each account Kolux adds runs in a private Codex home; the user's own Codex folder is
// never touched. The card is in one state at a time (ACCT-002); the accounts list itself is under
// Manage accounts (advanced), in CodexAccounts.tsx (ACCT-001, ACCT-019, T-138-c).
// Once connected the card shows Manage and Disconnect (ACCT-015): Disconnect removes only an
// account Kolux made, and for Codex's own login only explains how to sign out in Codex.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { clearReadFailure, connectFailed, readFailed } from "../onboarding/firstRun";
import { AttentionNote, fixDoes, fixFor, openInstallPage, type Attention } from "./Attention";
import { listen } from "@tauri-apps/api/event";
import VendorMark from "../chrome/VendorMark";
import { liveCheck, OtherWays, taglineOf } from "./ConnectGrid";
import { settleWithin } from "./pending";
import Ask, { type Question } from "../chrome/Ask";
import { CONNECT } from "../glossary";
import { who } from "./CodexAccounts";

export type CodexAccount = { id: string; email: string | null; home: string; lastSignIn: number; signInError: boolean; label?: string };
export type CodexView = {
  accounts: CodexAccount[];
  active: string | null;
  systemDefault: "chatgpt" | "api-key" | "custom-provider" | "signed-out";
  signingIn: "browser" | "device" | null;
  inBrowser: boolean;
  deviceLink: string | null;
  deviceCode: string | null;
  attention: Attention | null;
  /** Accounts whose home's config.toml no longer agrees with what Kolux wrote (SET-030). */
  drifted: string[];
  /** ACCT-019: accounts whose sign-in file has been gone longer than the grace period. */
  missing: string[];
  /** ACCT-021: why the user's Codex settings cannot be copied into the accounts, if they cannot. */
  settingsWarning: string | null;
};
export type CodexAction = { kind: "connect" } | { kind: "code" } | { kind: "cancel" } | { kind: "remove"; id: string } | { kind: "install" } | { kind: "disconnect" } | { kind: "again"; id: string };

/** ACCT-019: the active account whose sign-in is gone or was rejected. */
export function codexLapsed(v: CodexView): { account: CodexAccount; why: "missing" | "re-auth" } | null {
  const a = v.accounts.find((x) => x.id === v.active);
  if (!a) return null;
  if (v.missing.includes(a.id)) return { account: a, why: "missing" };
  if (a.signInError) return { account: a, why: "re-auth" };
  return null;
}

const systemLabel: Record<CodexView["systemDefault"], string> = {
  chatgpt: "a ChatGPT sign-in",
  "api-key": "an API key",
  "custom-provider": "an API key with a custom provider",
  "signed-out": "",
};
export function codexHeadline(v: CodexView): string {
  if (v.signingIn === "device") return v.deviceCode ? "Enter the code on any device" : "Asking for a sign-in code…";
  if (v.signingIn) return v.inBrowser ? "Finish signing in in the browser" : "Starting Codex's sign-in…";
  const lapsed = codexLapsed(v);
  if (lapsed) return `Sign in again · ${lapsed.account.label ? `${lapsed.account.label} · ` : ""}${who(lapsed.account)}`;
  const active = v.accounts.find((a) => a.id === v.active);
  if (active) return `Connected · ${active.label ? `${active.label} · ` : ""}${who(active)}`;
  if (v.systemDefault !== "signed-out") return `Connected · Codex's own login (${systemLabel[v.systemDefault]})`;
  return "Connect with your ChatGPT plan";
}

/** ACCT-015: what Disconnect asks. Only the active account Kolux made is removed. */
export function codexDisconnect(v: CodexView): Question {
  const active = v.accounts.find((a) => a.id === v.active);
  if (active)
    return {
      title: `Disconnect ${active.email ?? "this ChatGPT account"}?`,
      body: "Kolux removes this account and deletes the sign-in it saved for it. The account's Codex home, with its settings and sessions, stays. Your own Codex folder and its login stay as they are.",
      confirm: "Disconnect",
    };
  return { title: "Codex's own login stays", body: "Kolux did not make this sign-in, so Disconnect deletes nothing. To sign out of Codex itself, run codex logout in a terminal.", confirm: null };
}

export type CodexState = "connecting" | "connected" | "attention" | "needs-signin" | "disconnected";
export function codexState(v: CodexView): CodexState {
  if (v.signingIn !== null) return "connecting";
  if (codexLapsed(v)) return "needs-signin";
  if (v.active !== null || v.systemDefault !== "signed-out") return "connected";
  return v.attention ? "attention" : "disconnected";
}
const codexChip: Record<CodexState, string> = { connecting: "Connecting", connected: "Connected", attention: "Needs attention", "needs-signin": "Needs sign-in", disconnected: "Not connected" };

export function CodexCardView({ view, error, pending = false, onAction }: { view: CodexView | null; error?: string | null; pending?: boolean; onAction: (a: CodexAction) => void }) {
  // ACCT-035 (FIX-3): a first read that failed still shows the card and says why, never a blank gap.
  if (!view)
    return error ? (
      <section className="conn-card" aria-label="Codex" data-state="attention">
        <header className="conn-head">
          <VendorMark agent="codex" size={18} />
          <span className="conn-name">Codex</span>
        </header>
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      </section>
    ) : null;
  const state = codexState(view);
  const busy = state === "connecting";
  const lapsed = codexLapsed(view);
  const chip = lapsed ? (lapsed.why === "missing" ? "Needs sign-in" : "Needs re-auth") : codexChip[state];
  return (
    <section className="conn-card" aria-label="Codex" data-state={state}>
      <header className="conn-head">
        <VendorMark agent="codex" size={18} />
        <span className="conn-name">Codex</span>
        <span className={`conn-chip ${state}`}>{chip}</span>
      </header>
      <p className="conn-detail conn-tagline">{taglineOf("codex")}</p>
      <div className="conn-headline">{codexHeadline(view)}</div>
      {view.signingIn === "device" && view.deviceLink && view.deviceCode && (
        <div className="device-code" role="status">
          <p className="conn-detail">
            Open <span className="device-link">{view.deviceLink}</span> on this or another device, sign in, then enter:
          </p>
          <code className="device-value">{view.deviceCode}</code>
        </div>
      )}
      {view.signingIn === "browser" && view.inBrowser && <p className="conn-detail">Sign in on the ChatGPT page that opened. Kolux keeps the sign-in in a Codex home of its own.</p>}
      {!busy && view.accounts.length === 0 && view.systemDefault !== "signed-out" && <p className="conn-detail">{CONNECT.codex}</p>}
      <AttentionNote attention={view.attention} route="codex" busy={pending} onFix={(f) => onAction({ kind: fixDoes(f) === "install-page" ? "install" : fixDoes(f) === "check" ? "cancel" : "connect" })} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        {/* Cancel ends a sign-in, or with nothing running wipes a leftover needs-attention state */}
        {(busy || view.attention) && (
          <button className="btn" onClick={() => onAction({ kind: "cancel" })}>
            Cancel
          </button>
        )}
        {state === "connected" && (
          <>
            <OtherWays
              label="Manage"
              ways={[
                { label: "Add account", onPick: () => onAction({ kind: "connect" }), disabled: pending },
                { label: "Sign in with a code", onPick: () => onAction({ kind: "code" }), disabled: pending },
              ]}
            />
            <button className="btn danger" disabled={pending} onClick={() => onAction({ kind: "disconnect" })}>
              Disconnect
            </button>
          </>
        )}
        {state === "needs-signin" && lapsed && (
          <>
            <button className="btn primary" disabled={pending} onClick={() => onAction({ kind: "again", id: lapsed.account.id })}>
              Sign in again
            </button>
            <OtherWays
              label="Manage"
              ways={[
                { label: "Add account", onPick: () => onAction({ kind: "connect" }), disabled: pending },
                { label: "Sign in with a code", onPick: () => onAction({ kind: "code" }), disabled: pending },
              ]}
            />
            <button className="btn danger" disabled={pending} onClick={() => onAction({ kind: "disconnect" })}>
              Disconnect
            </button>
          </>
        )}
        {!busy && state !== "connected" && state !== "needs-signin" && (
          <>
            {/* a fix shown above takes Connect's place (ACCT-013: one button that fixes it) */}
            {!fixFor(view.attention, "codex") && (
              <button className="btn primary" disabled={pending} onClick={() => onAction({ kind: "connect" })}>
                {view.accounts.length > 0 ? "Add account" : "Connect"}
              </button>
            )}
            <OtherWays ways={[{ label: "Sign in with a code", onPick: () => onAction({ kind: "code" }), disabled: pending }]} />
          </>
        )}
      </div>
    </section>
  );
}

/** `onConnected`: told whether Codex counts as connected each time that changes (ONB-003). */
export default function CodexCard({ onConnected = () => {} }: { onConnected?: (on: boolean) => void } = {}) {
  const [view, setView] = useState<CodexView | null>(null);
  const on = !!view && codexState(view) === "connected";
  useEffect(() => onConnected(on), [onConnected, on]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const read = useCallback(() => {
    invoke<CodexView>("codex_accounts")
      .then((v) => {
        setView(v);
        setError(clearReadFailure);
      })
      .catch(() => setError(readFailed));
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
  const [ask, setAsk] = useState<Question | null>(null);
  const act = (a: CodexAction) => {
    setError(null);
    if (a.kind === "disconnect") return view && setAsk(codexDisconnect(view));
    const call =
      a.kind === "cancel"
        ? invoke("codex_account_cancel")
        : a.kind === "remove"
          ? invoke("codex_account_remove", { id: a.id })
          : a.kind === "install"
            ? openInstallPage("codex")
            : a.kind === "again"
              ? invoke("codex_account_sign_in", { device: false, again: a.id })
              : invoke("codex_account_sign_in", { device: a.kind === "code", again: null });
    if (a.kind !== "cancel") setPending(true);
    call.catch((e) => setError(a.kind === "connect" || a.kind === "code" || a.kind === "again" ? connectFailed("Codex", e) : String(e)));
    // ACCT-002: a choice comes back after 30 seconds even if no answer arrives.
    void settleWithin(call).then(() => {
      setPending(false);
      read();
    });
  };
  return (
    <>
      <CodexCardView view={view} error={error} pending={pending} onAction={act} />
      {ask && (
        <Ask
          {...ask}
          onCancel={() => setAsk(null)}
          onConfirm={() => {
            setAsk(null);
            if (view?.active) act({ kind: "remove", id: view.active });
          }}
        />
      )}
    </>
  );
}
