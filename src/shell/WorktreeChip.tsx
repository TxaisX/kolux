// The worktree a session runs in, as the pane header shows it (Txais, 2026-11-13): one workspace per project, each of its
// sessions a different worktree, so every cell says which one in words and in a colour the same worktree wears everywhere.
// The label is the name typed for the worktree, else its live branch; it ends in an ellipsis when long and the hover text
// has all of it. A click opens that worktree's menu (the actions its sidebar row used to have).
import type { CSSProperties } from "react";
import type { WorktreeTag } from "../projects/worktreeGrid";

type Props = {
  tag: WorktreeTag;
  /** The pane's own branch chip as git last answered it: its text is the live branch. */
  live: { text: string; tip: string } | null;
  onMenu?: (path: string, x: number, y: number) => void;
};

export default function WorktreeChip({ tag, live, onMenu }: Props) {
  const text = tag.typed ? tag.label : (live?.text ?? tag.label);
  return (
    <button
      type="button"
      className="chip wt-chip"
      style={{ "--wt": tag.color } as CSSProperties}
      title={`${live && !tag.typed && live.tip !== text ? `${text}\n${live.tip}\n` : `${tag.tip}\n`}Click for this worktree's actions`}
      aria-label={`Worktree ${text}`}
      aria-haspopup="menu"
      data-worktree-chip={tag.path}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onMenu?.(tag.path, r.left, r.bottom + 4);
      }}
    >
      <span className="wt-dot" aria-hidden="true" />
      <span className="wt-text">{text}</span>
    </button>
  );
}
