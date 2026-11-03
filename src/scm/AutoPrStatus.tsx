// T-655: the right panel's list of automatic pull request runs, one compact row per workspace: its
// name, the draft pull request (#N, opened outside Kolux like the Checks tab's links), the step it is
// on or why it stopped (blocked files are listed, never their contents) and a local-only marker.
// `notes` is rendered below the rows: the panel owner puts the review notes list there.
import { useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./AutoPrStatus.css";
import { enabledFor, realAutoPorts, runAutoPr, type AutoRemote } from "./autoPr";
import { openLinkFailed } from "./panelUx";
import { LOCAL_ONLY_TEXT, LocalOnlyGlyph } from "./LocalOnlyIcon";
import { dismissOneClick, oneClickRuns, stepWord, useOneClickAll, type Run } from "./oneClick";

const folderName = (dir: string) => dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;

/** The one line under the name: what it is doing, or how it ended. */
export function runLine(r: Run): string {
  if (r.state === "running") return stepWord(r) + "…";
  if (r.state === "failed") return r.message ?? "Stopped";
  if (r.auto?.kind === "local") return r.message ?? "Committed here; no remote, so nothing was pushed";
  if (r.pr) return r.pr.draft === false ? "Pushed; pull request is open" : "Pushed; draft pull request is up to date";
  return r.message ?? "Pushed";
}

/** Which buttons a row offers: a line that has ended can be dismissed, and one that stopped on a failure can be tried again. */
export const rowButtons = (r: Pick<Run, "state" | "neutral">): { dismiss: boolean; retry: boolean } => ({ dismiss: r.state !== "running", retry: r.state === "failed" && !r.neutral });

/** Why Retry must not run: the settings could not be read, or automatic pull requests are switched off for this folder now. Null when it may run. */
export function retryBlock(settings: Record<string, unknown> | null, dir: string, remote: AutoRemote): string | null {
  if (settings === null) return "The settings could not be read, so the automatic pull request was not run again.";
  return enabledFor(settings, dir, remote) ? null : "Automatic pull requests are switched off for this workspace now, so nothing was run. Turn them on in Settings to use Retry.";
}

export function AutoPrRow({ run }: { run: Run }) {
  const [openErr, setOpenErr] = useState<string | null>(null);
  const [retryNote, setRetryNote] = useState<string | null>(null);
  /** Retry follows the same switch as the automatic start: a folder switched off since the stop is not run. */
  const retry = async () => {
    setRetryNote(null);
    const settings = await invoke<Record<string, unknown>>("get_settings").catch(() => null);
    const remote = await realAutoPorts.remote(run.dir).catch(() => null);
    const why = remote === null ? (settings === null ? retryBlock(null, run.dir, "none") : null) : retryBlock(settings, run.dir, remote);
    if (why !== null) return setRetryNote(why);
    void runAutoPr(run.dir, realAutoPorts, remote ?? undefined);
  };
  const btn = rowButtons(run);
  const name = folderName(run.dir);
  const line = runLine(run);
  const stopped = run.state === "failed" && !run.neutral;
  const files = run.state === "failed" ? run.auto?.files ?? [] : [];
  return (
    <li className="apr-row" data-auto-pr data-state={run.state} data-tone={stopped ? "stop" : "ok"} style={{ listStyle: "none" }}>
      <div className="apr-line">
        <span className="apr-name" title={run.dir}>
          {name}
        </span>
        {run.auto?.local && (
          <span className="apr-local" role="img" title={LOCAL_ONLY_TEXT} aria-label={LOCAL_ONLY_TEXT}>
            <LocalOnlyGlyph />
          </span>
        )}
        {run.pr && (
          <a
            className="apr-link"
            href={run.pr.url}
            title={`${run.pr.title ?? "Draft pull request"}\n${run.pr.url}`}
            onClick={(e) => {
              e.preventDefault();
              setOpenErr(null);
              invoke("open_external", { url: run.pr?.url }).catch((err) => setOpenErr(openLinkFailed(err)));
            }}
          >
            {`#${run.pr.number}`}
          </a>
        )}
      </div>
      <div className="apr-step" role={stopped ? "alert" : "status"} title={line}>
        {line}
      </div>
      {retryNote && (
        <div className="apr-step note" role="status" title={retryNote}>
          {retryNote}
        </div>
      )}
      {openErr && (
        <div className="apr-step note error" role="alert" title={openErr}>
          {openErr}
        </div>
      )}
      {files.length > 0 && (
        <ul className="apr-files" aria-label="Files named in the stop">
          {files.slice(0, 5).map((f) => (
            <li key={f} title={f}>
              {f}
            </li>
          ))}
          {files.length > 5 && <li>and {files.length - 5} more</li>}
        </ul>
      )}
      {(btn.retry || btn.dismiss) && (
        <div className="apr-actions">
          {btn.retry && (
            <button type="button" className="btn" data-apr-retry title="Run the automatic pull request again for this workspace" onClick={() => void retry()}>
              Retry
            </button>
          )}
          {btn.dismiss && (
            <button type="button" className="btn ghost" data-apr-dismiss title="Hide this line" onClick={() => dismissOneClick(run.dir)}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function AutoPrStatus({ notes }: { notes?: ReactNode }) {
  useOneClickAll();
  const runs = oneClickRuns().filter((r) => r.auto !== undefined);
  return (
    <div className="apr" data-auto-pr-panel>
      {runs.length === 0 ? (
        <p className="apr-empty">No automatic pull request yet. Kolux opens one when an agent finishes a turn with changes.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }} aria-label="Automatic pull requests">
          {runs.map((r) => (
            <AutoPrRow key={r.dir} run={r} />
          ))}
        </ul>
      )}
      {notes !== undefined && notes !== null && <div className="apr-notes">{notes}</div>}
    </div>
  );
}
