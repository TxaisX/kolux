// GIT-061: a plain folder added as a project can start Git here. The dialog previews the first
// commit; a file whose name looks like a secret starts unticked and is left out unless chosen.
import { trapTab } from "../chrome/dialogFocus";
import { useState } from "react";
import { GLOSSARY } from "../glossary";

export type FirstFile = { path: string; secret: boolean };

/** The files a first commit takes by default: everything except what looks like a secret. */
export const defaultChosen = (files: FirstFile[]) => new Set(files.filter((f) => !f.secret).map((f) => f.path));

export function firstCommitLine(files: FirstFile[], chosen: Set<string>) {
  const out = files.filter((f) => !chosen.has(f.path)).length;
  const n = chosen.size;
  return `${n} file${n === 1 ? "" : "s"} in the first commit${out ? `, ${out} left out` : ""}.`;
}

export default function StartGit({ folder, files, busy, onStart, onFolder, onScan, onCancel }: { folder: string; files: FirstFile[]; busy: boolean; onStart: (files: string[]) => void; onFolder?: () => void; onScan?: () => void; onCancel: () => void }) {
  const [chosen, setChosen] = useState(() => defaultChosen(files));
  const toggle = (p: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (!next.delete(p)) next.add(p);
      return next;
    });
  return (
    <div className="ask-backdrop" onMouseDown={onCancel}>
      <div
        className="ask start-git"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label="Start Git in this folder"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          trapTab(e);
          if (e.key === "Escape") onCancel();
        }}
      >
        <h2 className="ask-title">Start Git in this folder?</h2>
        <p className="ask-body">
          {folder} is not a <span title={GLOSSARY.repository.hover}>Git {GLOSSARY.repository.plain}</span> yet. Kolux can start Git here and make a first commit of the files ticked below. Files that look like secrets are left out unless you tick them.
        </p>
        <ul className="first-files" aria-label="first commit files">
          {files.map((f) => (
            <li key={f.path}>
              <label>
                <input type="checkbox" checked={chosen.has(f.path)} onChange={() => toggle(f.path)} />
                <span className="first-path">{f.path}</span>
                {f.secret && <span className="first-secret">looks like a secret, left out</span>}
              </label>
            </li>
          ))}
          {files.length === 0 && <li className="first-none">The folder is empty; the first commit will be empty.</li>}
        </ul>
        <p className="ask-body">{firstCommitLine(files, chosen)}</p>
        {onFolder && <p className="ask-body">Or open it as a folder without Git: it gets one workspace, the folder itself, and becomes a Git project on its own if Git is started in it later.</p>}
        <div className="btn-row">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          {onScan && (
            <button className="btn" disabled={busy} onClick={onScan} title="The folder holds several repositories: list them and bring in the ones you pick">
              Look for Git projects inside
            </button>
          )}
          {onFolder && (
            <button className="btn" disabled={busy} onClick={onFolder}>
              Open as a folder
            </button>
          )}
          <button className="btn primary" autoFocus disabled={busy} onClick={() => onStart(files.filter((f) => chosen.has(f.path)).map((f) => f.path))}>
            Start Git and commit
          </button>
        </div>
      </div>
    </div>
  );
}
