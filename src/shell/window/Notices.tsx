// The window's toast and notice bar. They belong to the window, not to the Terminals screen: a copy
// confirmation or a failed save said on Board, Tower, Inbox or the Artifacts page is read there too
// (UX lane A, shell.md row 2). Content.tsx mounts this once, outside every screen's block.

type Props = { toast: string | null; notice: string | null; onDismiss: () => void };

export default function Notices({ toast, notice, onDismiss }: Props) {
  return (
    <>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {notice && (
        <div className="notice" role="alert">
          {notice}
          <button className="ib" onClick={onDismiss} title="Dismiss" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </>
  );
}
