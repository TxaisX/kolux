// SET-033 / PROJ-035: the setup part of a repository's page: the setup script kept in Kolux (shown,
// edited, removed), the repository's kolux.yaml script, which of them run, and whether the agent waits.
import { useCallback, useEffect, useRef, useState } from "react";
import { clearLeft, failLeft, keepLeft, takeLeft, useLeaveSave } from "./leave";
import { invoke } from "@tauri-apps/api/core";
import { choiceOptions, choiceSave, runsNote, scriptSave, trustedWords, trustNote, type RepoSetup } from "./setupChoice";

export interface SetupActions {
  onSave: (script: string) => void;
  onRemove: () => void;
  onChoice: (value: string) => void;
  onWait: (wait: boolean) => void;
  onMode?: (mode: string) => void;
  onUntrust?: () => void;
}

export function RepoSetupView({ setup, notice, status, start, leftError, actions }: { setup: RepoSetup; notice?: string | null; status?: string | null; start?: string; leftError?: string | null; actions: SetupActions }) {
  const [draft, setDraft] = useState(start ?? setup.local ?? "");
  const [composing, setComposing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [hint, setHint] = useState("");
  // C20-R4-01: a script taken back from a failed leave save is what the box must show; the reset that
  // follows `setup.local` acts only when that value really changes, not on mount (and not twice under
  // StrictMode).
  const lastLocal = useRef(setup.local);
  useEffect(() => {
    if (lastLocal.current === setup.local) return;
    lastLocal.current = setup.local;
    setDraft(setup.local ?? "");
  }, [setup.local]);
  const commit = () => {
    if (composing) return;
    const s = scriptSave(setup.local, draft);
    if (s.kind === "save") actions.onSave(s.script);
    setHint(s.kind === "empty" ? "To take the saved setup away, use Remove." : "");
    if (s.kind === "empty") setDraft(setup.local ?? ""); // the box shows what is still saved, not an empty box
  };
  useLeaveSave(() => draft !== (setup.local ?? "") && commit()); // SET-036: changing page or closing keeps what was typed
  const trust = trustNote(setup);
  const trusted = trustedWords(setup);
  return (
    <section className="conn-card" data-section="repo-setup">
      <h2 className="conn-name">Setup script</h2>
      <p className="conn-detail">Runs in a new tab when a workspace is made.</p>
      <div className="look-select">
        <span>Saved in Kolux</span>
        <textarea
          aria-label="Saved setup script"
          className="field"
          rows={3}
          placeholder="e.g. pnpm install"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onBlur={commit}
        />
      </div>
      {hint && <p className="conn-detail">{hint}</p>}
      {setup.local && (
        <div className="look-select" data-row="saved-setup">
          <span>Saved setup</span>
          {asking ? (
            <span>
              <button className="btn danger" onClick={() => (setAsking(false), actions.onRemove())}>
                Remove it
              </button>{" "}
              <button className="btn" onClick={() => setAsking(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button className="btn" onClick={() => setAsking(true)}>
              Remove
            </button>
          )}
        </div>
      )}
      {setup.shared && <pre className="conn-detail" data-shared>{setup.shared}</pre>}
      {setup.shared && (
        <p className="conn-detail">
          That is the setup script in kolux.yaml in the main folder of this repository. A branch can change it, and you are asked again if it does.
        </p>
      )}
      {setup.sharedError && (
        <p className="conn-detail warn" role="alert">
          {setup.sharedError}
        </p>
      )}
      <div className="look-select">
        <span>Which runs</span>
        <select aria-label="Which setup script runs" className="field" value={setup.policy ?? ""} onChange={(e) => actions.onChoice(e.target.value)}>
          {choiceOptions(setup).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {setup.runError && (
        <p className="conn-detail warn" role="alert" data-run-error="true">
          {setup.runError}
        </p>
      )}
      {setup.suggestBoth && (
        <p className="conn-detail" data-suggest="both">
          This repository has both a saved setup and one in kolux.yaml; only yours runs now.{" "}
          <button className="btn" onClick={() => actions.onChoice("both")}>
            Run both
          </button>
        </p>
      )}
      <p className="conn-detail">
        {runsNote(setup)} {trust}
      </p>
      {trusted && (
        // T-721: what Always trust or an approval allowed can be seen here and taken back; kolux.yaml asks again after
        <div className="look-select" data-row="trust">
          <span>Trusted</span>
          <span>
            {trusted}{" "}
            <button className="btn" onClick={actions.onUntrust}>
              Stop trusting
            </button>
          </span>
        </div>
      )}
      {status && (
        // the button that had focus is gone with its row: focus and announce what changed instead
        <p className="conn-detail" role="status" tabIndex={-1} autoFocus data-status="trust">
          {status}
        </p>
      )}
      <label className="check">
        <input type="checkbox" aria-label="Wait for setup" checked={setup.wait} onChange={(e) => actions.onWait(e.target.checked)} />
        The agent waits for setup to finish before it starts
      </label>
      <label className="check">
        Setup opens in{" "}
        <select aria-label="Setup opens in" value={setup.mode ?? "tab"} onChange={(e) => actions.onMode?.(e.target.value)}>
          <option value="tab">a new tab</option>
          <option value="right">a split to the right</option>
          <option value="down">a split below</option>
          <option value="ask">ask for each workspace (no bulk launch)</option>
        </select>
      </label>
      <p className="conn-detail">The New workspace dialog can still send setup to a split instead of a tab.</p>
      {leftError && (
        <p className="conn-detail warn" role="alert" data-left-error="true">
          The setup script could not be saved: {leftError}. What you typed is in the box.
        </p>
      )}
      {notice && (
        <p className="conn-detail warn" role="alert">
          {notice}
        </p>
      )}
    </section>
  );
}

/** The section for the repository at `path`: reads it, and every change writes through at once and reads back. */
export default function RepoSetupSection({ path }: { path: string }) {
  const [setup, setSetup] = useState<RepoSetup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // C20-R4-01: the script a leave save typed and, if that write failed, why: taken once on mount.
  const [left] = useState(() => takeLeft(`repo-setup:${path}`));
  const load = useCallback(() => {
    invoke<RepoSetup>("repo_setup_get", { path })
      .then((s) => (setSetup(s), setNotice(null)))
      .catch((e) => setNotice(String(e)));
  }, [path]);
  useEffect(load, [load]);
  const write = (cmd: string, args: Record<string, unknown>) =>
    invoke(cmd, { path, ...args })
      .then(load)
      .catch((e) => setNotice(String(e)));
  if (!setup) return notice ? <p className="conn-detail warn" role="alert">{notice}</p> : null;
  return (
    <RepoSetupView
      setup={setup}
      notice={notice}
      status={status}
      start={left?.value}
      leftError={left?.error}
      actions={{
        onSave: (script) => {
          // C20-R4-01: the script goes aside before the write, so a leave save that outlives this
          // section still has somewhere to come back to.
          const key = `repo-setup:${path}`;
          keepLeft(key, script);
          void invoke("repo_setup_save", { path, script })
            .then(() => {
              clearLeft(key);
              load();
            })
            .catch((e) => {
              failLeft(key, String(e));
              setNotice(String(e));
            });
        },
        onRemove: () => void write("repo_setup_remove", {}),
        onChoice: (value) => {
          const c = choiceSave(setup, value);
          if (c) void write("repo_setup_policy_set", { policy: c.policy });
        },
        onWait: (wait) => void write("repo_setup_wait_set", { wait }),
        onMode: (mode) => void write("repo_setup_mode_set", { mode }),
        onUntrust: () =>
          void invoke("repo_trust_clear", { path })
            .then(() => (setStatus("Kolux no longer trusts this repository's kolux.yaml: each script asks before it runs."), load()))
            .catch((e) => setNotice(String(e))),
      }}
    />
  );
}
