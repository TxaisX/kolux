// TERM-037: Fork Agent Session asks for a name before it starts; an empty name keeps the pane's own title.
import { useRef, useState } from "react";
import { Dialog } from "../ui/Dialog";
import "../agentstart/agentstart.css";
import { beginFork, endFork, forkTitle, newFork } from "./sessionFork";

type Props = { onCreate: (name: string | undefined) => void | Promise<void>; onCancel: () => void };

export default function ForkDialog({ onCreate, onCancel }: Props) {
  const [draft, setDraft] = useState(() => newFork());
  const name = useRef<HTMLInputElement>(null);
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
  // A src/ui Dialog: the name field takes focus, Tab stays inside, Escape and a click outside cancel.
  return (
    <Dialog onClose={onCancel} label="Fork Agent Session" className="agentstart-dialog" viewport="scrim" initialFocus={name} tabIndex={-1}>
      <h2>Fork Agent Session</h2>
      <p className="conn-detail">The new session starts from this one's history and then goes its own way.</p>
      <label className="auto-label">
        Name
        <input
          ref={name}
          className="field"
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
    </Dialog>
  );
}
