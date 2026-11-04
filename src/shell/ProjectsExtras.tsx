// T-302-b: the small pieces ProjectsPanel mounts (see projectsGlue.ts for the rules, and the patch for where they sit).
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import Ask from "../chrome/Ask";
import { askText } from "../editor/closeGuard";
import { askArchive } from "../setup/TrustPrompt";
import type { KeptBranch, KeptItem } from "../projects/cleanup";
import type { RemoveCheck } from "../projects/deleting";
import { outsideLines, outsideTitle } from "../projects/outsideCard";
import type { Worktree } from "../projects/model";
import type { BatchQuestion, Checked } from "../projects/selection";
import { selectionAfterDelete } from "../projects/selection";
import { planRemoval, questionFor } from "./projectsGlue";

/** PROJ-054: the two floating buttons at the foot of the list. */
export function ListButtons({ topShown, onTop, canJump, onJump }: { topShown: boolean; onTop: () => void; canJump: boolean; onJump: () => void }) {
  return (
    <div className="sb-float" role="group" aria-label="Move around the list">
      {canJump && (
        <button className="btn sb-jump" title="Scroll to the workspace that is open now, clearing filters that hide it" onClick={onJump}>
          Jump to current workspace
        </button>
      )}
      {topShown && (
        <button className="btn sb-top" aria-label="scroll to top" title="Back to the top of the list" onClick={onTop}>
          ↑
        </button>
      )}
    </div>
  );
}

/** PROJ-029: the suggestion to bring a behind base branch up to date, with Dismiss and the automatic-update switch. */
export function BehindNote({ text, refresh, onRefresh, onDismiss }: { text: string; refresh: boolean; onRefresh: (on: boolean) => void; onDismiss: () => void }) {
  return (
    <div className="sb-form" data-behind-note>
      <div className="sb-hint">{text}</div>
      <label className="check">
        <input type="checkbox" checked={refresh} onChange={(e) => onRefresh(e.target.checked)} /> Update the base branch first when creating a workspace
      </label>
      <div className="btn-row">
        <button className="btn" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** PROJ-043: workspaces made outside Kolux, as one compact card that opens to list them or is dismissed for good. */
export function OutsideCard({ outside, onDismiss }: { outside: Worktree[]; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const { lines, more } = outsideLines(outside);
  return (
    <div className="sb-notice sb-outside" data-outside-card>
      <button className="link" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Workspaces made with plain Git or another tool">
        {outsideTitle(outside.length)}
      </button>
      <button className="ib" aria-label="dismiss" title="Hide this card for this project" onClick={onDismiss}>
        Dismiss
      </button>
      {open && (
        <ul>
          {lines.map((l) => (
            <li key={l.path} title={l.path}>
              {l.label}
            </li>
          ))}
          {more > 0 && <li>and {more} more</li>}
        </ul>
      )}
    </div>
  );
}

type Say = (kind: "ok" | "warn", text: string) => void;
type Asked = { q: BatchQuestion; items: (Checked & { projectId: string })[] };

/** PROJ-058: the bar over the list while rows are picked, and the one question for all of them. */
export function PickedBar({
  picked,
  find,
  onRemoved,
  onKept = () => {},
  onLeft,
  onReload,
  say,
  unsavedIn = () => [],
  onAskUnsaved = async () => true,
}: {
  picked: string[];
  find: (path: string) => { projectId: string; name: string } | undefined;
  /** T-614: every workspace that went, in one call. */
  onRemoved: (paths: string[]) => void;
  /** PROJ-073: the branches that stayed, for the one review list. */
  onKept?: (items: KeptItem[]) => void;
  onLeft: (left: string[]) => void;
  onReload: () => Promise<unknown> | void;
  say: Say;
  /** EDIT-031: the file names with unsaved text in these workspaces, for the question. */
  unsavedIn?: (paths: string[]) => string[];
  /** EDIT-031: asks about those tabs (Save / Don't save / Cancel); true when the removal may go on. */
  onAskUnsaved?: (paths: string[]) => Promise<boolean>;
}) {
  const [asked, setAsked] = useState<Asked | null>(null);
  const [busy, setBusy] = useState(false);
  if (picked.length === 0) return null;

  const check = async () => {
    setBusy(true);
    try {
      const items: Asked["items"] = [];
      for (const path of picked) {
        const f = find(path);
        if (!f) continue;
        const c = await invoke<RemoveCheck>("workspace_remove_check", { projectId: f.projectId, path });
        items.push({ path, name: f.name, check: c, projectId: f.projectId });
      }
      setAsked({ q: questionFor(items), items });
    } catch (err) {
      say("warn", String(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!asked) return;
    // EDIT-031: its unsaved editor tabs are asked about first; on Cancel nothing is removed and no draft drops.
    if (!(await onAskUnsaved(planRemoval(asked.q, asked.items).map((s) => s.path)))) return;
    setBusy(true);
    const gone: string[] = [];
    const kept: KeptItem[] = [];
    try {
      for (const s of planRemoval(asked.q, asked.items)) {
        // T-613: no branch choice (null), so the workspace's own record decides and a branch holding commits found nowhere else stays.
        await askArchive(s.path);
        const k = await invoke<KeptBranch | null>("workspace_remove", { projectId: s.projectId, path: s.path, force: s.force, stamp: s.stamp, keepBranch: null });
        if (k) kept.push({ ...k, projectId: s.projectId });
        void invoke("editor_drafts_drop", { worktree: s.path }).catch(() => undefined);
        gone.push(s.path);
      }
      say("ok", `removed ${gone.length} workspace${gone.length === 1 ? "" : "s"} and their folders`);
      onLeft(selectionAfterDelete(asked.q, picked));
      setAsked(null);
    } catch (err) {
      say("warn", `${gone.length} removed, then: ${String(err)}`);
      onLeft(picked.filter((p) => !asked.q.removable.slice(0, gone.length).includes(p)));
      setAsked(null);
    } finally {
      if (gone.length > 0) onRemoved(gone); // T-614: once, so the window closes their tabs in one go
      if (kept.length > 0) onKept(kept);
      setBusy(false);
      await onReload();
    }
  };

  if (asked) {
    const { q } = asked;
    // EDIT-031: the files whose unsaved text would go with these workspaces.
    const dirtyNames = unsavedIn(planRemoval(q, asked.items).map((s) => s.path));
    return (
      <Ask
        title={q.title}
        body={
          <>
            {q.blocked.map((b) => (
              <div className="sb-hint" key={b.path}>
                {b.name} stays: {b.why}
              </div>
            ))}
            {q.dirty.map((d) => (
              <div className="sb-hint" key={d.path} title={d.lines.join("\n")}>
                {d.name} has changes that will be lost{d.lines.length ? `: ${d.lines.slice(0, 3).join(", ")}${d.more + Math.max(0, d.lines.length - 3) > 0 ? ", …" : ""}` : ""}
              </div>
            ))}
            {dirtyNames.length > 0 && (
              <>
                <span>{askText(dirtyNames)} Deleting these workspaces closes their tabs.</span>
                <ul className="del-changes" aria-label="files with unsaved changes">
                  {dirtyNames.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </>
            )}
          </>
        }
        confirm={q.removable.length === 0 ? null : busy ? "Removing…" : q.removable.length === 1 ? "Remove it" : `Remove ${q.removable.length}`}
        onConfirm={() => !busy && void remove()}
        onCancel={() => !busy && setAsked(null)}
      />
    );
  }
  return (
    <div className="sb-picked" data-picked-bar>
      <span>{picked.length} selected</span>
      <button className="btn" disabled={busy} title="Remove the selected workspaces with one question" onClick={() => void check()}>
        Remove…
      </button>
      <button className="btn" disabled={busy} onClick={() => onLeft([])}>
        Clear
      </button>
    </div>
  );
}

