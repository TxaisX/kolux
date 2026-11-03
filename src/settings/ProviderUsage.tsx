// T-547 (OD-01): the provider usage checks on Settings > AI connections. Only the two providers
// with a published usage service are here: the Kimi (Moonshot) balance and MiniMax's M Plan usage.
// Each row adds, replaces or removes that provider's API key; a kept key shows only as dots and its
// last four characters, and the key itself never comes back to this page (provider_usage.rs keeps
// it sealed). A check runs only when Check now is pressed. Claude, Codex and Gemini figures stay
// on what their own sessions report.
import { ResetButton } from "./SafetyRules";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type ProviderId = "kimi" | "minimax";
export type KeyRow = { provider: ProviderId; label: string; kept: boolean; masked: string | null };
export type Reading =
  | { state: "noKey" }
  | { state: "balance"; available: number; voucher: number; cash: number }
  | { state: "answered" }
  | { state: "badKey" }
  | { state: "rateLimited" }
  | { state: "offline" }
  | { state: "unavailable"; reason: string }
  | { state: "failed"; status: number };

const usd = (n: number) => `$${n.toFixed(2)}`;

/** What a check reads as, in one plain sentence; `warn` marks the ones that need the user. */
export function readingText(r: Reading): { text: string; warn: boolean } {
  switch (r.state) {
    case "noKey":
      return { text: "Add a key to check.", warn: false };
    case "balance":
      return { text: `Balance ${usd(r.available)} (vouchers ${usd(r.voucher)}, cash ${usd(r.cash)})`, warn: r.available <= 0 };
    case "answered":
      return { text: "MiniMax answered. It publishes no format for the figures yet, so none are shown.", warn: false };
    case "badKey":
      return { text: "The key was refused. Check it, or replace it.", warn: true };
    case "rateLimited":
      return { text: "Too many checks just now. Try again in a minute.", warn: true };
    case "offline":
      return { text: "No connection to the provider.", warn: true };
    case "unavailable":
      return { text: `Not checked: ${r.reason}.`, warn: false };
    case "failed":
      return { text: `The provider answered with an error (${r.status}).`, warn: true };
  }
}

export type ProviderAction = { kind: "save"; provider: ProviderId; value: string } | { kind: "forget"; provider: ProviderId } | { kind: "check"; provider: ProviderId };

export function ProviderUsageView({ rows, drafts, readings, pending = {}, onDraft, onAction }: { rows: KeyRow[]; drafts: Record<string, string>; readings: Partial<Record<ProviderId, Reading>>; pending?: Partial<Record<ProviderId, boolean>>; onDraft: (p: ProviderId, value: string) => void; onAction: (a: ProviderAction) => void }) {
  return (
    <section className="conn-card" aria-label="Provider usage">
      <header className="conn-head">
        <span className="conn-name">Provider usage</span>
      </header>
      <p className="conn-detail">Kolux asks Kimi and MiniMax for your usage only when you press Check now, with the key you add here. The key is kept sealed on this computer and never shown again in full.</p>
      {rows.map((r) => {
        const draft = drafts[r.provider] ?? "";
        const reading = readings[r.provider];
        const said = reading ? readingText(reading) : null;
        return (
          <div key={r.provider} data-provider={r.provider}>
            <div className="acct-list">
              <input className="field" type="password" aria-label={r.label} autoComplete="off" spellCheck={false} placeholder={r.kept ? "Paste to replace" : r.label} value={draft} onChange={(e) => onDraft(r.provider, e.target.value)} />
              <button className="btn" disabled={!draft.trim()} onClick={() => onAction({ kind: "save", provider: r.provider, value: draft })}>
                {r.kept ? "Replace" : "Add key"}
              </button>
              {r.kept ? (
                <ResetButton label="Remove" ariaLabel={`Remove ${r.label}`} yes="Yes, remove" onReset={() => onAction({ kind: "forget", provider: r.provider })} />
              ) : (
                <button className="btn" disabled>
                  Remove
                </button>
              )}
              <button className="btn" disabled={!r.kept || !!pending[r.provider]} onClick={() => onAction({ kind: "check", provider: r.provider })}>
                {pending[r.provider] ? "Checking…" : "Check now"}
              </button>
              <span className="conn-detail">{r.kept ? `Kept: ${r.masked ?? "••••"}` : "No key"}</span>
            </div>
            {said && (
              <p className={said.warn ? "conn-detail warn" : "conn-detail"} role="status">
                {said.text}
              </p>
            )}
          </div>
        );
      })}
    </section>
  );
}

export default function ProviderUsage() {
  const [rows, setRows] = useState<KeyRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [readings, setReadings] = useState<Partial<Record<ProviderId, Reading>>>({});
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<KeyRow[]>("provider_keys")
      .then(setRows)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(read, [read]);
  const [pending, setPending] = useState<Partial<Record<ProviderId, boolean>>>({});
  // A ref as well as state: a second click in the same frame must not slip past a stale render.
  const running = useRef<Partial<Record<ProviderId, boolean>>>({});
  const act = (a: ProviderAction) => {
    if (a.kind === "check") {
      if (running.current[a.provider]) return;
      running.current[a.provider] = true;
      setPending((m) => ({ ...m, [a.provider]: true }));
      invoke<Reading>("provider_usage_check", { provider: a.provider })
        .then((r) => {
          setError(null);
          setReadings((m) => ({ ...m, [a.provider]: r }));
        })
        .catch((e) => setError(String(e)))
        .finally(() => {
          running.current[a.provider] = false;
          setPending((m) => ({ ...m, [a.provider]: false }));
        });
      return;
    }
    const run = a.kind === "save" ? invoke<KeyRow[]>("provider_key_set", { provider: a.provider, value: a.value }) : invoke<KeyRow[]>("provider_key_forget", { provider: a.provider });
    run
      .then((next) => {
        setError(null);
        setRows(next);
        // The pasted key leaves the field at once, and an old reading no longer applies.
        setDrafts((d) => ({ ...d, [a.provider]: "" }));
        setReadings((m) => ({ ...m, [a.provider]: undefined }));
      })
      .catch((e) => setError(String(e)));
  };
  if (!rows) return error ? <p className="conn-detail warn" role="alert">{error}</p> : null;
  return (
    <>
      <ProviderUsageView rows={rows} drafts={drafts} readings={readings} pending={pending} onDraft={(p, value) => setDrafts((d) => ({ ...d, [p]: value }))} onAction={act} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
