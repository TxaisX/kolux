// VIEW-014 / PROJ-083: the Space page. The saved sizes show at once, a scan refreshes them, the
// treemap draws the biggest worktrees in a fixed square, and the table sorts, searches, filters to
// deletable rows and deletes the ticked ones after the same safety checks as a single delete (no force).
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import Ask from "../chrome/Ask";
import type { RemoveCheck } from "../projects/deleting";
import { folderName } from "../projects/model";
import { askArchive } from "../setup/TrustPrompt";
import { ageOf, deletable, formatBytes, formatCount, reclaimableBytes, selectedForDelete, treemap, visibleRows, type SortKey, type SpaceRow } from "../projects/space";
import { activeOf, afterBatch, chosenVisible, labelOf, latest, plan, question, removeArgs, stateOf, treemapItems, whyNotDeletable, type Batch, type Pick, type Skipped } from "./view";

type Props = { projectId: string | null; projectName: string; openDirs: string[] };
// T-744: `pid` is the project the question was asked in; after a project switch it is neither shown nor run.
type Pending = { go: SpaceRow[]; picks: Pick[]; skipped: Skipped[]; pid: string };

const cell: CSSProperties = { padding: "4px 8px", borderBottom: "1px solid var(--line-subtle)", whiteSpace: "nowrap" };
const num: CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" };

export default function SpaceView({ projectId, projectName, openDirs }: Props) {
  const [rows, setRows] = useState<SpaceRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("size");
  const [deletableOnly, setDeletableOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  // T-744: the project on screen now, so a check or delete that ends after a switch drops its answer.
  const shownId = useRef(projectId);
  shownId.current = projectId;

  // Latest-wins: a scan that finishes after a newer one (or after the project changed) is dropped.
  const scans = useRef(latest());
  const scan = async (id: string) => {
    const token = scans.current.begin();
    setScanning(true);
    try {
      const out = await invoke<SpaceRow[]>("space_scan", { projectId: id });
      if (!scans.current.current(token)) return;
      setRows(out);
      setNote(null);
    } catch (e) {
      if (scans.current.current(token)) setNote(`The scan failed: ${String(e)}`);
    } finally {
      if (scans.current.current(token)) setScanning(false);
    }
  };
  // PROJ-083: saved results first, then a fresh scan.
  useEffect(() => {
    setRows([]);
    setSelected([]);
    setNote(null);
    setPending(null);
    scans.current.cancel();
    setScanning(false);
    if (projectId === null) return;
    let gone = false;
    invoke<SpaceRow[]>("space_saved", { projectId })
      .then((saved) => {
        if (!gone && saved.length > 0) setRows((r) => (r.length ? r : saved));
      })
      .catch(() => {});
    void scan(projectId);
    return () => {
      gone = true;
    };
  }, [projectId]);

  const active = useMemo(() => activeOf(rows, openDirs), [rows, openDirs]);
  const shown = useMemo(() => visibleRows(rows, { query, sort, deletableOnly, active }), [rows, query, sort, deletableOnly, active]);
  const map = useMemo(() => treemap(treemapItems(rows)), [rows]);
  // Ticked rows the filter hides are not acted on.
  const chosen = useMemo(() => chosenVisible(selected, shown, rows, active), [selected, shown, rows, active]);
  const toggle = (path: string) => setSelected((s) => (s.includes(path) ? s.filter((p) => p !== path) : [...s, path]));

  // The question comes after the checks, so it can say which ticked rows are skipped and why.
  const askDelete = async () => {
    if (projectId === null || chosen.length === 0) return;
    setBusy(true);
    const { go, skipped } = selectedForDelete(chosen, rows, active);
    const checks: Record<string, RemoveCheck | string> = {};
    await Promise.all(go.map((r) => invoke<RemoveCheck>("workspace_remove_check", { projectId, path: r.path }).then((c) => (checks[r.path] = c), (e: unknown) => (checks[r.path] = String(e)))));
    const planned = plan(go, checks);
    setBusy(false);
    if (shownId.current !== projectId) return;
    const all = [...skipped, ...planned.skipped];
    if (planned.picks.length === 0) setNote(all.length ? all.map((s) => `Skipped ${labelOf(rows.find((r) => r.path === s.path) ?? ({ path: s.path, branch: null } as SpaceRow))}: ${s.why}`).join(" · ") : "Nothing to delete");
    else setPending({ go, picks: planned.picks, skipped: all, pid: projectId });
  };
  const runDelete = async () => {
    if (projectId === null || pending?.pid !== projectId) return;
    setPending(null);
    setBusy(true);
    try {
      for (const p of pending.picks) await askArchive(p.path);
      const batch = await invoke<Batch>("workspace_remove_many", removeArgs(projectId, pending.picks));
      if (shownId.current !== projectId) return;
      const out = afterBatch(rows, batch);
      setRows(out.rows);
      setSelected([]);
      setNote(out.note);
    } catch (e) {
      if (shownId.current === projectId) setNote(`The delete failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const q = pending?.pid === projectId ? question(pending.go, pending.picks, pending.skipped) : null;

  return (
    <section className="space" aria-label="Space" style={{ padding: "16px 20px", color: "var(--fg)", overflow: "auto", height: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Space · {projectName}</h2>
        <span style={{ fontSize: 12, color: "var(--fg-muted)" }}>
          {rows.length} workspaces · {formatBytes(rows.reduce((a, r) => a + r.size.bytes, 0))} · {formatBytes(reclaimableBytes(rows))} reclaimable
        </span>
        <button className="btn" disabled={scanning || projectId === null} onClick={() => projectId !== null && void scan(projectId)}>
          {scanning ? "Scanning…" : "Rescan"}
        </button>
      </header>
      {projectId === null ? (
        <div className="empty">
          <h2>No project</h2>
          <p>Add a project to see what its workspaces take.</p>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div aria-label="Biggest workspaces" style={{ position: "relative", width: "min(320px, 100%)", aspectRatio: "1 / 1", flex: "0 0 auto", border: "1px solid var(--line-subtle)", borderRadius: 6, overflow: "hidden" }}>
            {map.blocks.map((b) => (
              <div key={`${b.x},${b.y}`} title={`${b.label} · ${formatBytes(b.bytes)}`} style={{ position: "absolute", left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, boxSizing: "border-box", border: "1px solid var(--bg)", background: map.omitted > 0 && b.label === `${map.omitted} more` ? "var(--line-subtle)" : "var(--row-selected)", overflow: "hidden", fontSize: 11, padding: 3 }}>
                {b.label}
              </div>
            ))}
            {map.blocks.length === 0 && <div className="empty">{scanning ? "Scanning…" : "Nothing measured yet"}</div>}
          </div>
          <div style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input className="field" style={{ width: 200 }} placeholder="Search branch or folder" aria-label="Search workspaces" value={query} onChange={(e) => setQuery(e.target.value)} />
              <select className="field" style={{ width: "auto" }} aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="size">Biggest first</option>
                <option value="files">Most files first</option>
                <option value="age">Oldest first</option>
                <option value="branch">By branch</option>
              </select>
              <label style={{ fontSize: 12, display: "inline-flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={deletableOnly} onChange={(e) => setDeletableOnly(e.target.checked)} /> Deletable only
              </label>
              <button className="btn danger" disabled={busy || chosen.length === 0} onClick={() => void askDelete()}>
                {busy ? "Checking…" : `Delete selected${chosen.length ? ` (${chosen.length})` : ""}`}
              </button>
            </div>
            {note && (
              <div role="status" style={{ fontSize: 12, color: "var(--fg-muted)" }}>
                {note}
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                <thead>
                  <tr style={{ color: "var(--fg-muted)", textAlign: "left" }}>
                    <th style={cell} />
                    <th style={cell}>Branch</th>
                    <th style={cell}>Folder</th>
                    <th style={num}>Size</th>
                    <th style={num}>Files</th>
                    <th style={cell}>Changed</th>
                    <th style={cell}>State</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const can = deletable(r, active);
                    return (
                      <tr key={r.path} style={{ opacity: can ? 1 : 0.7 }}>
                        <td style={cell}>
                          <label className="hit-box"><input type="checkbox" aria-label={`Select ${labelOf(r)}`} disabled={!can} title={whyNotDeletable(r, active) ?? undefined} checked={can && chosen.includes(r.path)} onChange={() => toggle(r.path)} /></label>
                        </td>
                        <td style={cell}>{r.branch ?? <i>detached</i>}</td>
                        <td style={{ ...cell, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }} title={r.path}>
                          {folderName(r.path)}
                        </td>
                        <td style={num}>{formatBytes(r.size.bytes, r.size.incomplete)}</td>
                        <td style={num}>{formatCount(r.size.files, r.size.incomplete)}</td>
                        <td style={cell}>{ageOf(r, Date.now() / 1000)}</td>
                        <td style={cell}>{stateOf(r, active)}</td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ ...cell, color: "var(--fg-muted)" }}>
                        {rows.length === 0 ? (scanning ? "Scanning…" : "No workspaces measured") : "No row matches"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {q && pending && (
        <Ask
          title={q.title}
          body={
            <>
              {q.lines.map((l, i) => (
                <p key={i} style={{ margin: "0 0 6px" }}>
                  {l}
                </p>
              ))}
              {q.list.length > 0 && (
                <ul aria-label="Workspaces to delete" style={{ margin: "0 0 6px", paddingLeft: 18 }}>
                  {q.list.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              )}
            </>
          }
          confirm={q.confirm}
          onCancel={() => setPending(null)}
          onConfirm={() => void runDelete()}
        />
      )}
    </section>
  );
}
