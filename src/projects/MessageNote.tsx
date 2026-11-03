// PROJ-031: Kolux's sentence first; Git's own output stays one click away. The note is pinned
// above the scrolling list (never lost below many rows) and can be closed.
import { Close } from "../chrome/icons";
import { splitGitSaid } from "./model";

export function MessageNote({ kind, text, onDismiss, onUndo }: { kind: string; text: string; onDismiss?: () => void; onUndo?: () => void }) {
  const { summary, git } = splitGitSaid(text);
  return (
    <div className={`note ${kind}`} role={kind === "error" ? "alert" : "status"} data-message-note>
      {summary}
      {onUndo && (
        <button className="link" type="button" data-message-undo onClick={onUndo}>
          Undo
        </button>
      )}
      {onDismiss && (
        <button className="ib" type="button" title="Close this message" aria-label="Close this message" data-message-close onClick={onDismiss}>
          <Close size={12} />
        </button>
      )}
      {git && (
        <details>
          <summary>Git's full output</summary>
          <pre>{git}</pre>
        </details>
      )}
    </div>
  );
}
