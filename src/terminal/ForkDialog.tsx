// TERM-037: Fork Agent Session asks for a name before it starts; an empty name keeps the pane's own title.
import { trapTab } from "../chrome/dialogFocus";
import { useState } from "react";
import "../agentstart/agentstart.css";
import { beginFork, endFork, forkTitle, newFork } from "./sessionFork";

type Props = { onCreate: (name: string | undefined) => void | Promise<void>; onCancel: () => void };

export default function ForkDialog({ onCreate, onCancel }: Props) {
  const [draft, setDraft] = useState(() => newFork());
  const create = async () => {
    const begun = beginFork(draft);
    if (!begun.go) return;
    setDraft(begun.draft);
    try {
      await onCreate(forkTitle(draft.name));
    } finally {
      setDraft(endFork);
    }
  };
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="agentstart-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-label="Fork Agent Session" onKeyDown={(e) => (trapTab(e), e.key === "Escape" && onCancel())}>
        <h2>Fork Agent Session</h2>
        <p className="conn-detail">The new session starts from this one's history and then goes its own way.</p>
        <label className="auto-label">
          Name
          <input
            className="field"
            autoFocus
            maxLength={80}
            placeholder="Optional, shown as the pane title"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && void create()}
          />
        </label>
        <div className="auto-dialog-foot">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" disabled={draft.busy} onClick={() => void create()}>
            {draft.busy ? "Starting…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
