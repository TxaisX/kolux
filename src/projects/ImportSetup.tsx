// VIEW-112: a project just added that carries another worktree tool's setup file is offered its
// setup and teardown commands, copied into kolux.yaml; a file too large or malformed is named and
// offers nothing.

import { trapTab } from "../chrome/dialogFocus";

export type SetupImport = { file: string; setup: string | null; teardown: string | null; refused: string | null };

/** The files that were refused, with why, or null when none was. */
export function refusedLine(list: SetupImport[]): string | null {
  const out = list.filter((i) => i.refused).map((i) => `${i.file} was not read: ${i.refused}.`);
  return out.length ? out.join(" ") : null;
}

export default function ImportSetup({ project, path, list, busy, onImport, onClose }: { project: string; path: string; list: SetupImport[]; busy: boolean; onImport: (file: string) => void; onClose: () => void }) {
  const offers = list.filter((i) => !i.refused);
  const refused = refusedLine(list);
  return (
    <div className="ask-backdrop" onMouseDown={onClose}>
      <div
        className="ask start-git"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Import setup commands"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          trapTab(e);
          if (e.key === "Escape") onClose();
        }}
      >
        <h2 className="ask-title">Import setup commands?</h2>
        <p className="ask-body">
          {project} has setup commands from another tool. Kolux can copy them into kolux.yaml in {path}. New workspaces run them once kolux.yaml is committed.
        </p>
        {offers.map((o) => (
          <div key={o.file} className="import-offer">
            <div className="import-file">{o.file}</div>
            {o.setup && (
              <>
                <div className="import-label">Setup, when a workspace is made</div>
                <pre className="import-script">{o.setup}</pre>
              </>
            )}
            {o.teardown && (
              <>
                <div className="import-label">Teardown, when a workspace is removed</div>
                <pre className="import-script">{o.teardown}</pre>
              </>
            )}
            <div className="btn-row">
              <button className="btn primary" disabled={busy} onClick={() => onImport(o.file)}>
                {`Import from ${o.file}`}
              </button>
            </div>
          </div>
        ))}
        {refused && <p className="ask-body import-refused">{refused}</p>}
        <div className="btn-row">
          <button className="btn" autoFocus onClick={onClose}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
