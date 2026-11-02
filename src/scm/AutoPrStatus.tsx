// T-655: the right panel's list of automatic pull request runs, one compact row per workspace: its
// name, the draft pull request (#N, opened outside Kolux like the Checks tab's links), the step it is
// on or why it stopped (blocked files are listed, never their contents) and a local-only marker.
// `notes` is rendered below the rows: the panel owner puts the review notes list there.
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./AutoPrStatus.css";
import { LOCAL_ONLY_TEXT, LocalOnlyGlyph } from "./LocalOnlyIcon";
import { oneClickRuns, stepWord, useOneClickAll, type Run } from "./oneClick";

const folderName = (dir: string) => dir.replace(/[\/]+$/, "").split(/[\/]/).pop() || dir;

/** The one line under the name: what it is doing, or how it ended. */
export function runLine(r: Run): string {
  if (r.state === "running") return stepWord(r) + "…";
  if (r.state === "failed") return r.message ?? "Stopped";
  if (r.auto?.kind === "local") return r.message ?? "Committed here; no remote, so nothing was pushed";
  if (r.pr) return r.pr.draft === false ? "Pushed; pull request is open" : "Pushed; draft pull request is up to date";
  return r.message ?? "Pushed";
}

export function AutoPrRow({ run }: { run: Run }) {
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
              void invoke("open_external", { url: run.pr?.url });
            }}
          >
            {`#${run.pr.number}`}
          </a>
        )}
      </div>
      <div className="apr-step" role={stopped ? "alert" : "status"} title={line}>
        {line}
      </div>
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
