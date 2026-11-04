// After-list row 789: the one notice that names what startup recovery set aside or restored.
// C22-R2-01: when settings.json could not be read, the same notice offers the one explicit repair.

export default function RecoveryNotes({ notes, onDismiss, onRepair }: { notes: string[]; onDismiss: () => void; onRepair?: () => void }) {
  if (notes.length === 0) return null;
  return (
    <div className="notice recovery-notes" role="status" aria-label="Recovered at start" style={{ flexWrap: "wrap" }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {notes.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
      {onRepair && (
        <button className="btn" onClick={onRepair} title="Set the unreadable settings file aside and start fresh">
          Repair settings
        </button>
      )}
      <button className="ib" onClick={onDismiss} title="Dismiss">
        ×
      </button>
    </div>
  );
}
