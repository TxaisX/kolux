// VIEW-112: a project just added that carries another worktree tool's setup file is offered its
// setup and teardown commands, copied into kolux.yaml; a file too large or malformed is named and
// offers nothing.

import { useRef } from "react";
import { Dialog } from "../ui/Dialog";
import { refusedLine, type SetupImport } from "./setupImport";

export { refusedLine, type SetupImport };

export default function ImportSetup({ project, path, list, busy, onImport, onClose }: { project: string; path: string; list: SetupImport[]; busy: boolean; onImport: (file: string) => void; onClose: () => void }) {
  const offers = list.filter((i) => !i.refused);
  const refused = refusedLine(list);
  const notNow = useRef<HTMLButtonElement>(null);
  // A src/ui Dialog: Not now takes focus, Tab stays inside, Escape and a click outside close it. Presses and keys in it
  // stop at the box, so the sidebar it was opened from never sees them.
  return (
    <Dialog
      onClose={onClose}
      label="Import setup commands"
      className="ask start-git"
      viewport="ask-backdrop"
      initialFocus={notNow}
      tabIndex={-1}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
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
        <button ref={notNow} className="btn" onClick={onClose}>
          Not now
        </button>
      </div>
    </Dialog>
  );
}
