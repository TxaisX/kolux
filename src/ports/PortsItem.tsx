// VIEW-078: the Ports item of the status bar. It counts the ports the active workspace listens on
// and, when clicked, lists them with the address a dev server printed, an Open button (Kolux
// browser; Shift+Ctrl-click for the system browser) and a Stop button. Ports held by processes
// outside the workspace are listed as external and have no Stop. A failed scan names its problem
// and keeps the last good list. The tying of a port to a workspace, and every guard a Stop passes
// (same program as the row, every holder the workspace's own, a known Git worktree that is no home
// folder), happens in ports.rs; a refusal comes back as the note under the title, and a Stop that
// ended nothing (the program was already gone, or still runs but left the port) says so there too.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { openInBrowser } from "../browser/openIn";
import { restoreFocus } from "../shell/paletteCaps";
import { watchEscape } from "../switcher/accounts";
import { PrintedUrls, afterScan, capNote, decodeOutput, openAddress, openWhere, ownCount, rowKey, stopArgs, stopNote, type PortRow, type PortsView, type StopOutcome } from "./ports";
import "./ports.css";

type Props = { active: string | null; workspaces: string[] };

const CLOSED_MS = 10_000;
const OPEN_MS = 2_000;

export default function PortsItem({ active, workspaces }: Props) {
  const printed = useMemo(() => new PrintedUrls(), []);
  const [view, setView] = useState<PortsView>({ rows: [], error: null });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [noteBad, setNoteBad] = useState(false);
  const [stopping, setStopping] = useState<string[]>([]);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const latest = useRef({ active, workspaces });
  latest.current = { active, workspaces };

  // The addresses dev servers print are picked up from every terminal's output, each bound to the terminal that printed it.
  useEffect(() => {
    const off = listen<{ id: number; data: string }>("terminal-output", (e) => printed.record(decodeOutput(e.payload.data), e.payload.id));
    return () => void off.then((f) => f());
  }, [printed]);

  // Escape closes the popover wherever focus is; focus goes into it on open and back to the trigger on close.
  useEffect(() => (open ? watchEscape(window, () => setOpen(false)) : undefined), [open]);
  useEffect(() => {
    if (open) menu.current?.focus();
    else if (wasOpen.current) restoreFocus(button.current, (sel) => document.querySelector<HTMLElement>(sel));
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (active === null) return setView({ rows: [], error: null });
    let live = true;
    const scan = () =>
      invoke<PortRow[]>("ports_list", { workspaces: latest.current.workspaces, active })
        .then((rows) => live && setView((v) => afterScan(v, { rows })))
        .catch((err) => live && setView((v) => afterScan(v, { error: String(err) })));
    setView({ rows: [], error: null });
    void scan();
    const t = setInterval(scan, open ? OPEN_MS : CLOSED_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [active, open]);

  if (active === null) return null;
  const rect = open ? button.current?.getBoundingClientRect() : null;
  const say = (text: string, bad = false) => (setNote(text), setNoteBad(bad));
  const stop = (r: PortRow) => {
    const k = rowKey(r);
    setStopping((s) => [...s, k]);
    return invoke<StopOutcome>("ports_stop", stopArgs(workspaces, active, r))
      .then((outcome) => say(stopNote(r.port, outcome)))
      .catch((err) => say(`Could not stop port ${r.port}: ${err}`, true))
      .finally(() => setStopping((s) => s.filter((x) => x !== k)));
  };
  const openRow = (r: PortRow, e: MouseEvent) => {
    const url = openAddress(r, printed.forPort(r.port, view.rows));
    if (openWhere(e) === "system") void invoke("open_external", { url }).catch((err) => say(String(err), true));
    else openInBrowser(url);
  };
  return (
    <>
      <button ref={button} className="item ports-open" data-item="ports" title="Ports this workspace is listening on" aria-haspopup="dialog" aria-expanded={open} onClick={() => (setNote(null), setNoteBad(false), setOpen((o) => !o))}>
        Ports {ownCount(view.rows)}
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={menu} tabIndex={-1} className="menu ports-menu" role="dialog" aria-label="Ports" style={{ left: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 380)), bottom: Math.max(8, window.innerHeight - (rect?.top ?? 0) + 4), minWidth: 340 }}>
            <div className="menu-title">Ports</div>
            {view.error && <div className="note error">{view.error}{view.rows.length > 0 ? " Showing the last list." : ""}</div>}
            {note && <div className={noteBad ? "note error" : "note"} role="status">{note}</div>}
            {view.rows.length === 0 && !view.error && <div className="sb-hint">Nothing in this workspace is listening on a port.</div>}
            {view.rows.map((r) => (
              <div key={rowKey(r)} className="menu-item ports-row" data-port={r.port} data-external={r.external}>
                <span className="name">
                  {r.port} <span className="reason">{openAddress(r, printed.forPort(r.port, view.rows))}</span>
                  {r.external && <span className="reason"> · external</span>}
                </span>
                <button className="btn" aria-label={`Open port ${r.port}`} title="Open in the Kolux browser (Shift+Ctrl-click: system browser)" onClick={(e) => openRow(r, e)}>
                  Open
                </button>
                {!r.external && (
                  <button className="btn" aria-label={`Stop port ${r.port}`} title="Stop the process listening here" disabled={stopping.includes(rowKey(r))} onClick={() => void stop(r)}>
                    {stopping.includes(rowKey(r)) ? "Stopping…" : "Stop"}
                  </button>
                )}
              </div>
            ))}
            {capNote(view.rows) && <div className="sb-hint">{capNote(view.rows)}</div>}
          </div>
        </>
      )}
    </>
  );
}
