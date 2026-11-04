// PROJ-012 / PROJ-013: scan a folder for the repositories inside it, tick the ones to bring in,
// and add them as one group or as separate projects. With nothing ticked the folder itself can be
// opened as a folder project. The scan and the import run in Rust (repo_scan.rs); the shape of
// the list lives in scanView.ts.
import { useDialogFocus } from "../chrome/dialogFocus";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { begin, importLine, scanToStop, setAll, stopNow, summary, take, toggle, type ScanEvent, type ScanState } from "./scanView";
import type { Project } from "./model";

type Props = { root: string; onClose: () => void; onDone: (message: string, project?: Project) => void; onProblem: (err: unknown) => void };

const lastSegment = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

export default function ScanRepos({ root: first, onClose, onDone, onProblem }: Props) {
  const [root, setRoot] = useState(first);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [grouped, setGrouped] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef<ScanState | null>(null);
  // T-738: focus on the folder field, Escape from anywhere, Tab kept inside, focus back to the opener on close.
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useDialogFocus(box, onClose, () => field.current);
  live.current = scan;

  useEffect(() => {
    const off = listen<ScanEvent>("repo-scan", (e) => setScan((s) => (s ? take(s, e.payload) : s)));
    return () => {
      void off.then((f) => f());
      // Closing mid-scan must not leave the walk running in the background.
      const running = scanToStop(live.current);
      if (running !== null) void invoke("repo_scan_stop", { scanId: running });
    };
  }, []);
  // Steady labels follow the list; they depend on the paths only.
  const paths = scan?.found.map((f) => f.path).join("\n") ?? "";
  useEffect(() => {
    if (!scan || scan.found.length === 0) return setLabels([]);
    let current = true;
    invoke<string[]>("repo_scan_labels", { root, paths: scan.found.map((f) => f.path) })
      .then((l) => current && setLabels(l))
      .catch(() => current && setLabels([]));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  const start = async () => {
    const id = Date.now();
    setScan(begin(id));
    try {
      await invoke("repo_scan_start", { root, scanId: id });
    } catch (err) {
      setScan(null);
      onProblem(err);
    }
  };
  const stop = () => {
    if (!scan) return;
    void invoke("repo_scan_stop", { scanId: scan.scanId });
    setScan(stopNow(scan));
  };
  const browse = async () => {
    try {
      const picked = await open({ directory: true, multiple: false, title: "Choose a folder holding repositories" });
      if (typeof picked === "string") setRoot(picked);
    } catch (err) {
      onProblem(err);
    }
  };
  const importTicked = async () => {
    if (!scan) return;
    setBusy(true);
    try {
      const out = await invoke<{ projects: Project[]; group: { name: string } | null; skipped: { path: string; reason: string }[] }>("repo_import", { root, paths: scan.ticked, grouped, name });
      const skipped = out.skipped.length ? `; ${out.skipped.length} could not be added (${out.skipped[0].reason})` : "";
      onDone(`${out.projects.length} ${out.projects.length === 1 ? "project" : "projects"} added${out.group ? ` in the group ${out.group.name}` : ""}${skipped}`);
    } catch (err) {
      onProblem(err);
    } finally {
      setBusy(false);
    }
  };
  const openFolder = async () => {
    setBusy(true);
    try {
      const p = await invoke<Project>("project_add_folder", { path: root });
      onDone(`${p.name} is open as a folder project`, p);
    } catch (err) {
      onProblem(err);
    } finally {
      setBusy(false);
    }
  };

  const nothing = scan !== null && scan.ticked.length === 0;
  return (
    <div className="ask-backdrop" onMouseDown={onClose}>
      <div className="ask scan-repos" role="dialog" aria-modal="true" ref={box} tabIndex={-1} aria-label="Scan a folder for repositories" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <h2 className="ask-title">Look for repositories</h2>
        <div className="btn-row">
          <input className="field" aria-label="folder to scan" ref={field} value={root} onChange={(e) => setRoot(e.target.value)} disabled={scan?.running} />
          <button className="btn" onClick={() => void browse()} disabled={scan?.running}>
            Browse
          </button>
          {scan?.running ? (
            <button className="btn" data-scan-stop onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn primary" data-scan-start onClick={() => void start()} disabled={!root.trim()}>
              {scan ? "Scan again" : "Scan"}
            </button>
          )}
        </div>
        {scan && (
          <>
            <p className="ask-body" role="status">
              {summary(scan)}
            </p>
            <ul className="first-files" aria-label="repositories found">
              {scan.found.map((f, i) => (
                <li key={f.path}>
                  <label title={f.linked ? `Found through the linked worktree ${f.linked}` : f.path}>
                    <input type="checkbox" checked={scan.ticked.includes(f.path)} disabled={f.bare} onChange={() => setScan(toggle(scan, f.path))} />
                    <span className="first-path">{labels[i] ?? f.name}</span>
                    {f.bare && <span className="first-secret">bare repository: nothing to open</span>}
                    {f.linked && <span className="first-secret">main checkout of a linked worktree</span>}
                  </label>
                </li>
              ))}
              {scan.found.length === 0 && !scan.running && <li className="first-none">No repositories were found here.</li>}
            </ul>
            {scan.found.length > 0 && (
              <div className="btn-row">
                <button className="btn" onClick={() => setScan(setAll(scan, true))}>
                  Tick all
                </button>
                <button className="btn" onClick={() => setScan(setAll(scan, false))}>
                  Untick all
                </button>
              </div>
            )}
            <label className="conn-switch">
              <input type="radio" name="scan-how" checked={grouped} onChange={() => setGrouped(true)} />
              <span>One group</span>
            </label>
            {grouped && <input className="field" aria-label="group name" placeholder={lastSegment(root)} value={name} onChange={(e) => setName(e.target.value)} />}
            <label className="conn-switch">
              <input type="radio" name="scan-how" checked={!grouped} onChange={() => setGrouped(false)} />
              <span>Separate projects</span>
            </label>
            <p className="ask-body">{importLine(scan, grouped)}</p>
          </>
        )}
        <div className="btn-row">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          {scan && nothing && !scan.running && (
            <button className="btn" data-scan-folder disabled={busy} onClick={() => void openFolder()} title="Add the scanned folder itself as a project, without Git">
              Open {lastSegment(root)} as a folder
            </button>
          )}
          <button className="btn primary" data-scan-import disabled={busy || !scan || nothing} onClick={() => void importTicked()}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
