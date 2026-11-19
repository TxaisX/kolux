// VIEW-023 / VIEW-025: a Board card's chip row under its pane: the word, the line, the newest file written,
// Approve and Deny for a named permission, and (T-609) Review changes on a Done card. Moved out of
// TerminalPane.tsx unchanged (evidence/product-ux-TerminalPane.patch), so the Board owns its card.
import type { Chip } from "./chip";
import { canReview } from "./review";
import { folderName } from "../projects/model";

export function ChipRow({ chip, onAnswer, onReview }: { chip: Chip; onAnswer?: (approve: boolean) => void; onReview?: () => void }) {
  return (
    <div className={`chip-row ${chip.lane}`}>
      <span className="chip-word">{chip.word}</span>
      {chip.line && (
        <span className="chip-line" title={chip.line}>
          {chip.line}
        </span>
      )}
      {chip.file && (
        <span className="chip-file" title={chip.file} data-path={chip.file}>
          {folderName(chip.file)}
        </span>
      )}
      {chip.answer && onAnswer && (
        <span className="chip-actions">
          <button className="btn primary" onClick={() => onAnswer(true)} title="Approve: the agent carries on">
            Approve
          </button>
          <button className="btn" onClick={() => onAnswer(false)} title="Deny: the agent is told no">
            Deny
          </button>
        </span>
      )}
      {canReview(chip.lane) && onReview && (
        <span className="chip-actions">
          <button className="btn" onClick={onReview} title="Read every file this agent changed, in All Changes">
            Review changes
          </button>
        </span>
      )}
    </div>
  );
}
