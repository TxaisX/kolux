// GIT-032: a pull request the host reports as conflicting. Shows which files conflict (a local trial merge,
// nothing is changed), what that blocks, and an AI resolve button that sends the ask to the workspace's agent
// through the orchestration send. If no agent runs there, it says so and the prompt can be copied.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { copyText } from "./panelUx";
import { conflictView, type Conflicts } from "./review";

type Props = { dir: string; url: string };

function CopyButton({ text, label, onFail }: { text: string; label: string; onFail: (failed: boolean) => void }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      className="btn"
      data-copy-state={state}
      onClick={() => {
        void copyText(text).then((ok) => {
          setState(ok ? "done" : "failed");
          onFail(!ok);
          setTimeout(() => setState("idle"), 1500);
        });
      }}
    >
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

export default function ConflictPanel({ dir, url }: Props) {
  const [c, setC] = useState<Conflicts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setC(null);
    setError(null);
    setSent(null);
    setCopyFailed(false);
    invoke<Conflicts>("scm_pr_conflicts", { worktree: dir, url }).then(
      (r) => live && setC(r),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [dir, url]);

  const v = conflictView(c);
  const resolve = () => {
    if (!c?.prompt || busy) return;
    setBusy(true);
    setError(null);
    invoke<{ terminal: string }>("scm_review_send", { worktree: dir, text: c.prompt })
      .then((r) => setSent(r.terminal))
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="note warn conflict-panel" data-conflict={v.kind}>
      <div>This pull request has merge conflicts with its base branch; its checks cannot run and it cannot merge until they are resolved.</div>
      {error ? <div className="sb-hint">{error}</div> : <div className="sb-hint">{v.text}</div>}
      {v.kind === "files" && c && (
        <ul className="conflict-files">
          {c.files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {v.commands.length > 0 && <pre className="conflict-cmds">{v.commands.join("\n")}</pre>}
      <div className="cm-row">
        {c?.prompt && (
          <button className="btn" disabled={busy} onClick={resolve}>
            {busy ? "Sending…" : "Resolve with AI"}
          </button>
        )}
        {c?.prompt && <CopyButton text={c.prompt} label="Copy prompt" onFail={setCopyFailed} />}
        {v.commands.length > 0 && <CopyButton text={v.commands.join("\n")} label="Copy commands" onFail={setCopyFailed} />}
      </div>
      {copyFailed && (
        <div className="note error" role="alert" data-copy-error>
          Copy failed: this window could not write to the clipboard. Select the text above and copy it by hand.
        </div>
      )}
      {sent && <div className="sb-hint">Sent to {sent}. Check the pull request again once the agent has merged and pushed.</div>}
    </div>
  );
}
