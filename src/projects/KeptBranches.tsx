// PROJ-073: a workspace opened on an existing branch goes and the branch stays. One kept branch is a
// notice with a Delete button; a batch is one review list where only ticked branches are deleted.
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { keptAfter, keptBatches, keptView, type BranchResult, type KeptItem } from "./cleanup";

/** After-list row 129: deleting a kept branch also drops any commits on it that were never pushed or merged. */
export const UNPUSHED_NOTE = "Commits on it that were never pushed or merged go with it.";

type Props = {
  items: KeptItem[];
  /** What is still pending after a delete (the refused ones stay). */
  onChange: (items: KeptItem[]) => void;
  /** Said once, as the sidebar's note. */
  onSay: (kind: "ok" | "warn", text: string) => void;
  /** The branch list may have changed. */
  onDeleted?: () => void;
};

export default function KeptBranches({ items, onChange, onSay, onDeleted = () => {} }: Props) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const view = keptView(items);
  if (view === "none") return null;
  const keyOf = (k: KeptItem) => `${k.projectId}\n${k.branch}`;
  // One branch asked from the notice counts as ticked; the review list starts with nothing ticked.
  const isTicked = (k: KeptItem) => (view === "toast" ? true : ticked[keyOf(k)] === true);
  const run = async () => {
    const all: Record<string, boolean> = {};
    for (const k of items) all[keyOf(k)] = isTicked(k);
    setBusy(true);
    const results: BranchResult[] = [];
    try {
      // one repository at a time, one branch after another
      for (const batch of keptBatches(items, all)) {
        const done = await invoke<BranchResult[]>("branch_delete_kept", { projectId: batch.projectId, items: batch.items });
        // Each result clears only its own project's item, even when two projects share a branch name (T2-F01).
        results.push(...done.map((r) => ({ ...r, projectId: batch.projectId })));
      }
    } catch (err) {
      onSay("warn", String(err));
      setBusy(false);
      return;
    }
    setBusy(false);
    onChange(keptAfter(items, results));
    const refused = results.filter((r) => !r.deleted);
    const done = results.length - refused.length;
    if (done > 0) onDeleted();
    if (refused.length > 0) onSay("warn", refused.map((r) => `${r.branch}: ${r.why ?? "not deleted"}`).join(" "));
    else onSay("ok", done === 1 ? `deleted the branch ${results[0].branch}` : `deleted ${done} branches`);
  };
  return (
    <div className="sb-form" data-kept-branches={view}>
      {view === "toast" ? (
        <span>
          The folder is gone and the branch <b>{items[0].branch}</b> stays. Delete the branch as well? {UNPUSHED_NOTE}
        </span>
      ) : (
        <>
          <label>These branches stayed when their workspaces went. Tick the ones to delete. {UNPUSHED_NOTE}</label>
          {items.map((k) => (
            <label className="check" key={keyOf(k)}>
              <input type="checkbox" aria-label={`delete branch ${k.branch}`} checked={isTicked(k)} onChange={(e) => setTicked({ ...ticked, [keyOf(k)]: e.target.checked })} />
              {k.branch}
            </label>
          ))}
        </>
      )}
      <div className="btn-row">
        <button className="btn danger" onClick={() => void run()} disabled={busy || (view === "review" && !items.some(isTicked))}>
          {busy ? "Deleting…" : view === "toast" ? "Delete branch" : "Delete ticked"}
        </button>
        <button className="btn" onClick={() => onChange([])} disabled={busy}>
          Keep
        </button>
      </div>
    </div>
  );
}
