// VIEW-076: the folder workspace's Attached worktrees and PR Checks tabs. They are offered by the
// right panel (T-146-g mounts them for a folder workspace); rows refresh on their own and on demand.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { PrChecks } from "../scm/checks";
import { ATTACHED_REFRESH_MS, attachedRows, rollup, rollupLine } from "./attachedTabs";
import type { Worktree } from "./model";

type Props = { folder: string; worktrees: Worktree[]; onOpen?: (path: string) => void };

export function AttachedWorktreesTab({ folder, worktrees, onOpen }: Props) {
  const rows = attachedRows(folder, worktrees);
  return (
    <div data-attached-worktrees>
      {rows.length === 0 && <p className="conn-detail">No workspace is attached to this folder yet. One made from a terminal here is listed, and so is one made from it.</p>}
      {rows.map((r) => (
        <button key={r.path} className="btn" style={{ display: "block", paddingLeft: 8 + r.depth * 16 }} title={r.path} onClick={() => onOpen?.(r.path)}>
          {r.label}
          {r.branch && r.branch !== r.label ? ` · ${r.branch}` : ""}
        </button>
      ))}
    </div>
  );
}

export function FolderChecksTab({ folder, worktrees }: Props) {
  const rows = attachedRows(folder, worktrees);
  const paths = rows.map((r) => r.path).join("\n");
  const [answers, setAnswers] = useState<Record<string, PrChecks | null>>({});
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void Promise.all(
      paths
        .split("\n")
        .filter(Boolean)
        .map((p) =>
          invoke<PrChecks>("scm_pr_checks", { worktree: p, linked: null })
            .then((c) => [p, c] as const)
            .catch(() => [p, null] as const),
        ),
    )
      .then((got) => (setAnswers(Object.fromEntries(got)), setError(null)))
      .catch((e) => setError(String(e)));
  }, [paths]);
  useEffect(() => {
    load();
    const t = setInterval(load, ATTACHED_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);
  return (
    <div data-folder-checks>
      <p className="conn-detail" data-rollup>
        {rollupLine(rollup(folder, worktrees, answers))}
      </p>
      {error && <p className="conn-detail warn">{error}</p>}
      <button className="btn" onClick={load}>
        Refresh
      </button>
    </div>
  );
}
