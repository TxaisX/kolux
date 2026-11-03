// Three small choices under Manage accounts (advanced) on Settings > AI connections:
// ACCT-022 the Codex folder past sessions are read from (empty = the standard folder, Reset),
// ACCT-028 MiniMax usage credentials (a session cookie and an API key, each saved, replaced or
// forgotten and marked as kept on this computer; the endpoint, group id and model names), shown
// only where MiniMax is detected, and ACCT-029 the experimental Gemini CLI credentials switch,
// shown only where Gemini is detected and off until turned on. The backend is agent_creds.rs;
// secrets never come back to this page, only whether one is kept.
import { ResetButton } from "./SafetyRules";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type CredsView = {
  sessionsHome: string;
  sessionsFolder: string | null;
  sessionsFolderFound: boolean;
  minimax: { detected: boolean; cookieKept: boolean; keyKept: boolean; endpoint: "overseas" | "mainland"; groupId: string; usageModel: string; modelNames: string };
  geminiDetected: boolean;
  geminiEnabled: boolean;
};
export type CredsAction =
  | { kind: "sessions"; path: string }
  | { kind: "save"; field: "cookie" | "key"; value: string }
  | { kind: "forget"; field: "cookie" | "key" }
  | { kind: "options"; endpoint: string; groupId: string; usageModel: string; modelNames: string }
  | { kind: "gemini"; on: boolean };

/** ACCT-022: what sits under the folder field. */
export function sessionsNote(v: CredsView): string {
  if (!v.sessionsHome) return v.sessionsFolder ? `Empty means the standard Codex folder (${v.sessionsFolder}).` : "Empty means the standard Codex folder.";
  return v.sessionsFolderFound ? "Past sessions are read from this folder." : "That folder is not there, so no past sessions show until it is.";
}

/** ACCT-028: a credential's status word. */
export function keptNote(kept: boolean): string {
  return kept ? "Kept on this computer" : "Not saved";
}

const FIELDS: { field: "cookie" | "key"; label: string }[] = [
  { field: "cookie", label: "MiniMax session cookie" },
  { field: "key", label: "MiniMax API key" },
];

export function AgentCredentialsView({ view, drafts, onDraft, onAction }: { view: CredsView; drafts: Record<string, string>; onDraft: (name: string, value: string) => void; onAction: (a: CredsAction) => void }) {
  const m = view.minimax;
  const text = (name: string, stored: string) => drafts[name] ?? stored;
  return (
    <section className="conn-card" aria-label="Agent folders and credentials">
      <header className="conn-head">
        <span className="conn-name">Codex session folder</span>
      </header>
      <div className="acct-list">
        <input className="field" aria-label="Codex folder for past sessions" placeholder="Standard Codex folder" value={text("sessions", view.sessionsHome)} onChange={(e) => onDraft("sessions", e.target.value)} />
        <button className="btn" onClick={() => onAction({ kind: "sessions", path: text("sessions", view.sessionsHome) })}>
          Use this folder
        </button>
        <button className="btn" disabled={!view.sessionsHome && !drafts.sessions} onClick={() => onAction({ kind: "sessions", path: "" })}>
          Reset
        </button>
      </div>
      <p className="conn-detail">{sessionsNote(view)}</p>
      {m.detected && (
        <div data-section="minimax">
          <header className="conn-head">
            <span className="conn-name">MiniMax usage</span>
          </header>
          <p className="conn-detail">To copy the session cookie: sign in to MiniMax in your browser, open the browser's developer tools, find the Cookie header of any request to MiniMax, and paste its value here.</p>
          {FIELDS.map(({ field, label }) => {
            const kept = field === "cookie" ? m.cookieKept : m.keyKept;
            const name = `mm-${field}`;
            return (
              <div className="acct-list" key={field}>
                <input className="field" type="password" aria-label={label} autoComplete="off" placeholder={kept ? "Paste to replace" : label} value={drafts[name] ?? ""} onChange={(e) => onDraft(name, e.target.value)} />
                <button className="btn" disabled={!(drafts[name] ?? "").trim()} onClick={() => onAction({ kind: "save", field, value: drafts[name] ?? "" })}>
                  {kept ? "Replace" : "Save"}
                </button>
                {kept ? (
                  <ResetButton label="Forget" ariaLabel={`Forget ${label}`} yes="Yes, forget" onReset={() => onAction({ kind: "forget", field })} />
                ) : (
                  <button className="btn" disabled>
                    Forget
                  </button>
                )}
                <span className="conn-detail">{keptNote(kept)}</span>
              </div>
            );
          })}
          <div className="acct-list">
            <select className="field" aria-label="MiniMax endpoint" value={drafts["mm-endpoint"] ?? m.endpoint} onChange={(e) => onDraft("mm-endpoint", e.target.value)}>
              <option value="overseas">Overseas</option>
              <option value="mainland">Mainland China</option>
            </select>
            <input className="field" aria-label="MiniMax group id" placeholder="Group id (optional)" value={text("mm-group", m.groupId)} onChange={(e) => onDraft("mm-group", e.target.value)} />
            <input className="field" aria-label="MiniMax usage model" placeholder="general" value={text("mm-model", m.usageModel === "general" ? "" : m.usageModel)} onChange={(e) => onDraft("mm-model", e.target.value)} />
            <input className="field" aria-label="MiniMax model names" placeholder="Model names (optional)" value={text("mm-names", m.modelNames)} onChange={(e) => onDraft("mm-names", e.target.value)} />
            <button
              className="btn"
              onClick={() => onAction({ kind: "options", endpoint: text("mm-endpoint", m.endpoint), groupId: text("mm-group", m.groupId), usageModel: text("mm-model", m.usageModel === "general" ? "" : m.usageModel), modelNames: text("mm-names", m.modelNames) })}
            >
              Save options
            </button>
          </div>
        </div>
      )}
      {view.geminiDetected && (
        <label className="conn-detail" data-section="gemini">
          <input type="checkbox" checked={view.geminiEnabled} onChange={(e) => onAction({ kind: "gemini", on: e.target.checked })} /> Use Gemini CLI credentials (experimental): Kolux reads the Gemini CLI's own sign-in to show usage.
        </label>
      )}
    </section>
  );
}

export default function AgentCredentials() {
  const [view, setView] = useState<CredsView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(() => {
    invoke<CredsView>("agent_creds_view")
      .then(setView)
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(() => {
    read();
    const stop = listen("agent-creds", read);
    return () => void stop.then((f) => f()).catch(() => {});
  }, [read]);
  const act = (a: CredsAction) => {
    const run =
      a.kind === "sessions"
        ? invoke("codex_sessions_home_set", { path: a.path })
        : a.kind === "save"
          ? invoke("minimax_credential_set", { field: a.field, value: a.value })
          : a.kind === "forget"
            ? invoke("minimax_credential_forget", { field: a.field })
            : a.kind === "options"
              ? invoke("minimax_options_set", { endpoint: a.endpoint, groupId: a.groupId, usageModel: a.usageModel, modelNames: a.modelNames })
              : invoke("gemini_cli_credentials_set", { on: a.on });
    run
      .then(() => {
        setError(null);
        // A saved or forgotten credential and a Reset leave no stale text behind.
        setDrafts((d) => {
          const next = { ...d };
          if (a.kind === "sessions") delete next.sessions;
          if (a.kind === "save") delete next[`mm-${a.field}`];
          if (a.kind === "options") for (const k of ["mm-endpoint", "mm-group", "mm-model", "mm-names"]) delete next[k];
          return next;
        });
        read();
      })
      .catch((e) => setError(String(e)));
  };
  if (!view) return error ? <p className="conn-detail warn" role="alert">{error}</p> : null;
  return (
    <>
      <AgentCredentialsView view={view} drafts={drafts} onDraft={(name, value) => setDrafts((d) => ({ ...d, [name]: value }))} onAction={act} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
