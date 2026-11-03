// GIT-022 (T-228-d): the progress notice of the one-click flow. It lists the steps in order, marks
// the current one, and keeps its shape with long names: each name is one line cut with an ellipsis
// (the full text stays in the tooltip) and the notice never grows past its container.
import { STEPS, dismissOneClick, stepWord, useOneClick, type Run, type StepId } from "./oneClick";

const row = { display: "flex", alignItems: "center", gap: 6, minWidth: 0 } as const;
const cut = { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

const mark = (run: Run, id: StepId): "done" | "now" | "skipped" | "todo" | "failed" => {
  const i = STEPS.indexOf(id);
  const at = STEPS.indexOf(run.step);
  if (run.skipped.includes(id)) return "skipped";
  if (i < at || (i === at && run.state === "done")) return "done";
  if (run.neutral && i >= at) return "skipped";
  if (i === at) return run.state === "failed" ? "failed" : "now";
  return "todo";
};
const GLYPH = { done: "✓", now: "…", skipped: "–", todo: "·", failed: "×" } as const;

export function OneClickView({ run, onDismiss }: { run: Run; onDismiss?: () => void }) {
  return (
    <div className="scm-ask" data-oneclick data-state={run.state} role="status" aria-live="polite" aria-label="Pull request progress" style={{ overflow: "hidden", maxWidth: "100%" }}>
      <div className="scm-ask-title" style={cut}>
        {run.state === "done" ? `Pull request #${run.pr?.number ?? ""} opened` : run.neutral ? "Branch ready for your review text" : run.state === "failed" ? "Stopped" : "Creating the pull request"}
      </div>
      {STEPS.map((id) => {
        const m = mark(run, id);
        const word = stepWord({ step: id, push: run.push });
        return (
          <div key={id} data-step={id} data-mark={m} style={{ ...row, opacity: m === "todo" || m === "skipped" ? 0.55 : 1, fontWeight: m === "now" ? 600 : 400 }}>
            <span aria-hidden style={{ width: 14, textAlign: "center", flex: "none" }}>
              {GLYPH[m]}
            </span>
            <span style={cut} title={word}>
              {word}
            </span>
          </div>
        );
      })}
      {run.message && (
        <div className={run.neutral ? "note warn" : "note error"} role={run.neutral ? "status" : "alert"} style={{ overflowWrap: "anywhere" }}>
          {run.message}
        </div>
      )}
      {run.state === "done" && run.pr?.url && (
        <a href={run.pr.url} target="_blank" rel="noreferrer" style={cut} title={run.pr.url}>
          {run.pr.url}
        </a>
      )}
      {run.state !== "running" && onDismiss && (
        <button className="btn" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

/** The notice for a folder's manual run, if it has one. An automatic run (T-653) shows in AutoPrStatus instead. */
export default function OneClickNotice({ dir }: { dir: string }) {
  const run = useOneClick(dir);
  return run === null || run.auto ? null : <OneClickView run={run} onDismiss={() => dismissOneClick(dir)} />;
}
