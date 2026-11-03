// APP-054: the Resource Manager, opened from the status bar's memory figure. Memory and CPU for the
// app, for every terminal session grouped under its workspace, and the computer's free memory.
// Ending a session asks first, in the row, and stops that session only; a session a fresh read shows
// has already ended just leaves the list, with no question (VIEW-099). Committed memory (CLI-041)
// sits beside resident in every row, a dash where Windows gave no figure (T-287-b). Manage Sessions
// (VIEW-099 rest, T-153-e) ends the shells no pane shows in one go, never an agent's session, and
// offers nothing while the window is still loading its workspaces. FIX-2: never told that the window
// has loaded means still loading; a shell with a program running in it is not offered; End N ends
// only the sessions its question named.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { formatMemory } from "./memory";
import { cleanupCandidates, EndQuestion, endConfirmed, ManageSessions, paneless, sessionsLoaded, type InventoryTab } from "./manage";
import { committedNote, endNeedsAsk, escapeStep, formatCommitted, formatCpu, groupSessions, RES_COLUMNS, singleFlight, type Resources, type Row, type SessionUsage, type Usage } from "./resources";
import { bulkQuestion, bulkReport, leftOver, type Bulk, type BulkKind } from "../shell/endAll";
import BackgroundSessions from "../terminal/BackgroundSessions";
import { useDialogFocus } from "../chrome/dialogFocus";

const cols = { gridTemplateColumns: RES_COLUMNS };

/** `loaded` (T-153-e): whether the window has finished loading its workspaces, so its panes have
 * claimed their sessions; until then no row says it is in a pane or out of one. Not given: not loaded. */
type Props = { names: () => Record<number, string>; workspaces: string[]; loaded?: () => boolean; onClose: () => void };

export default function ResourceManager({ names, workspaces, loaded, onClose }: Props) {
  const [data, setData] = useState<Resources | null>(null);
  const [tabs, setTabs] = useState<InventoryTab[] | null>(null);
  const [failed, setFailed] = useState("");
  // usage-status.md:2: a kill that failed keeps its own message, which only the user (Dismiss) or the next End clears;
  // the 2 s read clears `failed` on success, so the kill's error cannot live there.
  const [killError, setKillError] = useState("");
  const killFailed = (e: unknown) => setKillError(`Could not end the session: ${String(e)}`);
  // usage-status.md:19: true while an End all / Restart / End N run is going, so a second one cannot start on top.
  const [running, setRunning] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // The background sessions' End question, when it is open: Escape closes it before the panel.
  const background = useRef<(() => void) | null>(null);
  const [ending, setEnding] = useState<Row | null>(null);
  // TERM-045's close check per paneless shell: true when a program runs in it; null when it failed.
  const [busy, setBusy] = useState<Record<number, boolean> | null>(null);
  // The sessions the open End N question names; End kills only these.
  const [asking, setAsking] = useState<SessionUsage[] | null>(null);
  // The session tab inventory says which sessions run an agent; a failed read offers nothing.
  const readTabs = () =>
    invoke<InventoryTab[]>("session_tabs")
      .then((t) => (Array.isArray(t) ? t : null))
      .catch(() => null)
      .then((t) => {
        setTabs(t);
        return t;
      });
  const read = () =>
    invoke<Resources>("resources")
      .then((r) => {
        setData(r);
        setFailed("");
        return r;
      })
      .catch((e) => {
        setFailed(String(e));
        return null;
      });
  const readBusy = (r: Resources | null, t: InventoryTab[] | null) => {
    const ids = r ? paneless(r.sessions, t, names(), sessionsLoaded(loaded)).map((s) => s.id) : [];
    const asked: Promise<Record<number, boolean> | null> = ids.length === 0
      ? Promise.resolve({})
      : invoke<boolean[]>("terminal_busy", { ids })
          .then((b) => (Array.isArray(b) && b.length === ids.length ? Object.fromEntries(ids.map((id, i) => [id, b[i] !== false])) : null))
          .catch(() => null);
    return asked.then((b) => {
      setBusy(b);
      return b;
    });
  };
  // One fresh read of the sessions, the inventory and the busy check; what Manage Sessions offers now.
  const refresh = async () => {
    const [r, t] = await Promise.all([read(), readTabs()]);
    const b = await readBusy(r, t);
    return r ? cleanupCandidates(r.sessions, t, names(), sessionsLoaded(loaded), b) : [];
  };
  // A fresh read first: when every offered session has already ended, the count updates with no question.
  const askAll = async () => {
    const now = await refresh();
    setAsking(now.length > 0 ? now : null);
  };
  const endAll = async () => {
    const confirmed = (asking ?? []).map((c) => c.id);
    setAsking(null);
    setKillError("");
    setRunning(true);
    try {
      await endConfirmed(confirmed, refresh, (id) => invoke("terminal_kill", { id }).catch(killFailed));
      await refresh();
    } finally {
      setRunning(false);
    }
  };
  const ask = async (row: Row) => {
    if (endNeedsAsk(await read(), row.id)) setEnding(row);
  };
  // SET-042 / SET-060 (T-285): End all and Restart end every session a fresh read lists at the click, after a question;
  // the report comes from a read after the kills, so it says what really ended.
  const [bulk, setBulk] = useState<Bulk | null>(null);
  const [report, setReport] = useState<{ text: string; ok: boolean } | null>(null);
  const askBulk = async (kind: BulkKind) => {
    const r = await read();
    const ids = r ? r.sessions.map((s) => s.id) : [];
    setBulk(ids.length > 0 ? { kind, ids } : null);
    if (ids.length === 0) setReport(bulkReport(kind, [], []));
  };
  const runBulk = async () => {
    if (!bulk) return;
    setBulk(null);
    setKillError("");
    setRunning(true);
    try {
      const ended = await endConfirmed(bulk.ids, () => read().then((r) => r?.sessions ?? []), (id) => invoke("terminal_kill", { id }).catch(killFailed));
      const fresh = await read();
      setReport(bulkReport(bulk.kind, ended, leftOver(ended, fresh?.sessions ?? null)));
      await refresh();
    } finally {
      setRunning(false);
    }
  };
  const bulkQ = bulk ? bulkQuestion(bulk.kind, bulk.ids) : null;
  useEffect(() => {
    // usage-status.md:11: a tick is skipped while the last read is still running, so slow reads do not pile up.
    const tick = singleFlight(refresh);
    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => clearInterval(t);
  }, []);
  // usage-status.md:8: the popup takes focus, keeps Tab inside and gives focus back; Escape closes the End question
  // that is open first, and the whole panel only when none is.
  // The box itself takes focus on open (tabindex -1, not a Tab stop): at mount the figures, and so the buttons, are not drawn yet.
  useDialogFocus(box, () => {
    const step = escapeStep({ bulk: bulk !== null, ending: ending !== null, asking: asking !== null, background: background.current !== null });
    if (step === "bulk") setBulk(null);
    else if (step === "ending") setEnding(null);
    else if (step === "asking") setAsking(null);
    else if (step === "background") background.current?.();
    else onClose();
  }, () => box.current);
  const end = async (row: Row) => {
    setEnding(null);
    setKillError("");
    await invoke("terminal_kill", { id: row.id }).catch(killFailed);
    await read();
  };
  const isLoaded = sessionsLoaded(loaded);
  const groups = data ? groupSessions(data.sessions, names(), workspaces, isLoaded) : [];
  const candidates = data ? cleanupCandidates(data.sessions, tabs, names(), isLoaded, busy) : [];

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={box} className="menu res-pop" role="dialog" aria-label="Resource Manager" tabIndex={-1}>
        <div className="res-head">
          <span className="menu-title">Resources</span>
          {data && <span className="res-free">{data.free === null ? "Free memory unknown" : `${formatMemory(data.free)} free${data.total === null ? "" : ` of ${formatMemory(data.total)}`}`}</span>}
        </div>
        {failed && <div className="menu-hint warn">{failed}</div>}
        {killError && (
          <div className="menu-hint warn" role="alert" data-kill="error">
            <span>{killError}</span>{" "}
            <button className="btn" onClick={() => setKillError("")}>
              Dismiss
            </button>
          </div>
        )}
        {data && (
          <div className="res-row res-cols" style={cols} aria-hidden="true">
            <span className="res-label">Name</span>
            <span className="res-label res-fig" title="Memory in RAM now (working set)">
              Resident
            </span>
            <span className="res-label res-fig" title="Memory Windows has promised the process (pagefile-backed)">
              Committed
            </span>
            <span className="res-label res-fig">CPU</span>
            <span />
          </div>
        )}
        {data && (
          <div className="res-row res-app" data-row="app" style={cols}>
            <span className="res-name">Kolux</span>
            <span className="res-fig">{formatMemory(data.app.bytes)}</span>
            {committedCell(data.app)}
            <span className="res-fig">{formatCpu(data.app.cpu)}</span>
            <span className="res-end" />
          </div>
        )}
        {report && (
          <div className={`menu-hint${report.ok ? "" : " warn"}`} role="status" data-bulk="report">
            {report.text}
          </div>
        )}
        {bulkQ && (
          <div className="res-ask res-bulk" role="alertdialog" aria-label={bulkQ.label} data-bulk="ask">
            <span>{bulkQ.text}</span>
            <span className="btn-row">
              <button className="btn danger" onClick={() => void runBulk()}>
                {bulkQ.confirm}
              </button>
              <button className="btn" autoFocus onClick={() => setBulk(null)}>
                Keep
              </button>
            </span>
          </div>
        )}
        {data && data.sessions.length === 0 && <div className="menu-hint">No terminal sessions are running.</div>}
        {data && data.sessions.length > 0 && !bulkQ && (
          <div className="res-row res-bulk" data-bulk="offer" style={{ display: "flex", justifyContent: "flex-end", gap: "6px" }}>
            <button className="btn" disabled={running} onClick={() => void askBulk("all")} title="End every terminal session that is running now; asks first">
              End all
            </button>
            <button className="btn" disabled={running} onClick={() => void askBulk("restart")} title="Kill every terminal pane and start over; asks first (the terminals run inside Kolux, there is no separate service)">
              Restart terminals
            </button>
          </div>
        )}
        {data && data.sessions.length > 0 && <ManageSessions loaded={isLoaded} candidates={asking ?? candidates} asking={asking !== null} onAsk={() => void askAll()} onEnd={() => void endAll()} onKeep={() => setAsking(null)} />}
        <BackgroundSessions loaded={isLoaded} question={background} />
        {groups.map((g) => (
          <section key={g.dir ?? ""} className="res-group" aria-label={g.label}>
            <div className="res-label" title={g.dir ?? "Terminals started outside any workspace"}>
              {g.label}
            </div>
            {g.rows.map((r) =>
              ending?.id === r.id ? (
                <EndQuestion key={r.id} name={r.name} shown={r.shown} onEnd={() => void end(r)} onKeep={() => setEnding(null)} />
              ) : (
                <div key={r.id} className="res-row" data-session={r.id} style={cols}>
                  <span className="res-name" title={`${r.processes} process${r.processes === 1 ? "" : "es"}${r.dir ? ` in ${r.dir}` : ""}`}>
                    {r.name}
                    {r.pid !== null && <span className="res-pid"> · pid {r.pid}</span>}
                  </span>
                  <span className="res-fig">{formatMemory(r.bytes)}</span>
                  {committedCell(r)}
                  <span className="res-fig">{formatCpu(r.cpu)}</span>
                  <button className="btn res-end" onClick={() => void ask(r)} title={`End ${r.name}`} aria-label={`End ${r.name}`}>
                    End
                  </button>
                </div>
              ),
            )}
          </section>
        ))}
      </div>
    </>
  );
}

/** MERGE 52 / FIX-1: the committed figure, or a dash with "(n of m could not be read)" under it when some process gave none. */
export function committedCell(u: Usage) {
  const note = committedNote(u);
  return (
    <span className="res-fig" data-fig="committed" title={note ? `${formatCommitted(u.committed)} ${note}` : undefined}>
      {formatCommitted(u.committed)}
      {note && <span className="res-unread" style={{ display: "block", fontSize: "11px", lineHeight: 1.2 }}>{note}</span>}
    </span>
  );
}
