// UX lane A (shell.md row 12): the placeholder for a restored tab that kept its kind but lost its data (see lostWords.ts).
import type { Pane } from "../../App";
import { lostWords } from "./lostWords";

export default function LostPane({ kind, hidden, onFocus, onClose }: { kind: NonNullable<Pane["kind"]>; hidden: boolean; onFocus: () => void; onClose: () => void }) {
  const w = lostWords(kind);
  return (
    <div className="pane" hidden={hidden} onMouseDown={onFocus}>
      <div className="empty" role="status">
        <h2>{w.title}</h2>
        <p>{w.body}</p>
        <button className="btn" onClick={onClose}>
          {w.close}
        </button>
      </div>
    </div>
  );
}
