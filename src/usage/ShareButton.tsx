// USAGE-020: the button that shares a usage card to X is plain text. Another company's logo never
// goes on it (Txais, 2026-10-06: "a plain share icon or the word Share"); the word is the whole
// button, so nothing here can draw a third-party mark. T-263-b mounts it on the share dialog.
export const SHARE_X_LABEL = "Share on X";

export default function ShareButton({ onShare, busy = false }: { onShare: () => void; busy?: boolean }) {
  return (
    <button type="button" className="btn" onClick={onShare} disabled={busy} title="Opens the post in your browser">
      {SHARE_X_LABEL}
    </button>
  );
}
