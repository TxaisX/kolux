// VIEW-078: the Ports item of the status bar. It counts the ports the active workspace listens on
// and, when clicked, lists them with the address a dev server printed, an Open button (which hands
// the address to the system browser, since Kolux no longer draws web pages) and a Stop button. Ports
// held by processes outside the workspace are listed as external and have no Stop. A failed scan names its problem
// and keeps the last good list. The tying of a port to a workspace, and every guard a Stop passes
// (same program as the row, every holder the workspace's own, a known Git worktree that is no home
// folder), happens in ports.rs; a refusal comes back as the note under the title, and a Stop that
// ended nothing (the program was already gone, or still runs but left the port) says so there too.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { openExternal } from "../open/openExternal";
import { restoreFocus } from "../shell/paletteCaps";
import { watchEscape } from "../switcher/accounts";
import { chunkBytes } from "../terminal/codec";
import { onTerminalOutput } from "../terminal/outputBus";
import { PrintedUrls, addressText, afterScan, capNote, openAddress,  ownCount, rowKey, stopArgs, stopNote, type PortRow, type PortsView, type StopOutcome } from "./ports";
import "./ports.css";
import OutOfFlow from "../chrome/OutOfFlow";

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
  // The row key of a Stop that was pressed with keyboard focus on it: when that row disappears focus would fall to the page body.
  const stopFocus = useRef<string | null>(null);
  const scanned = useRef<string | null>(null); // the workspace the list on screen belongs to
  const latest = useRef({ active, workspaces });
  latest.current = { active, workspaces };

  // The addresses dev servers print are picked up from every terminal's output, each bound to the terminal that printed it.
  useEffect(() => {
    const off = onTerminalOutput((e) => printed.record(addressText(chunkBytes(e)), e.id)); // DT-C245: decoded once for every reader
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
    const k = stopFocus.current;
    if (k === null || !open || view.rows.some((r) => rowKey(r) === k)) return;
    stopFocus.current = null;
    menu.current?.focus();
  }, [view.rows, open]);

  useEffect(() => {
    if (active === null) {
      scanned.current = null;
      return setView({ rows: [], error: null });
    }
    let live = true;
    const scan = () =>
      invoke<PortRow[]>("ports_list", { workspaces: latest.current.workspaces, active })
        .then((rows) => live && setView((v) => afterScan(v, { rows })))
        .catch((err) => live && setView((v) => afterScan(v, { error: String(err) })));
    // N-17: only a different workspace clears the list. Opening or closing the popover kept clearing it, so the
    // count dropped to nothing on a click and a failed scan threw away the last good list it says it still shows.
    if (scanned.current !== active) {
      scanned.current = active;
      setView({ rows: [], error: null });
    }
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
  const stop = (r: PortRow, focused: boolean) => {
    const k = rowKey(r);
    // aria-disabled, not disabled: a disabled button drops the focus it holds.
    if (stopping.includes(k)) return Promise.resolve();
    stopFocus.current = focused ? k : null;
    setStopping((s) => [...s, k]);
    return invoke<StopOutcome>("ports_stop", stopArgs(workspaces, active, r))
      .then((outcome) => {
        if (outcome !== "stopped") stopFocus.current = null;
        say(stopNote(r.port, outcome));
      })
      .catch((err) => {
        stopFocus.current = null;
        say(`Could not stop port ${r.port}: ${err}`, true);
      })
      .finally(() => setStopping((s) => s.filter((x) => x !== k)));
  };
  const openRow = (r: PortRow) => {
    const url = openAddress(r, printed.forPort(r.port, view.rows));
    void openExternal(url).catch((err) => say(String(err), true));
  };
  return (
    <>
      <button ref={button} className="item ports-open" data-item="ports" title="Ports this workspace is listening on" aria-haspopup="dialog" aria-expanded={open} onClick={() => (setNote(null), setNoteBad(false), setOpen((o) => !o))}>
        Ports {ownCount(view.rows)}
      </button>
      {open && (
        <OutOfFlow>
          <div className="menu-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={menu} tabIndex={-1} className="menu ports-menu" role="dialog" aria-label="Ports" style={{ left: Math.max(8, Math.min(rect?.left ?? 8, window.innerWidth - 380)), bottom: Math.max(8, window.innerHeight - (rect?.top ?? 0) + 4), minWidth: 340 }}>
            <div className="menu-title">Ports</div>
            {view.error && <div className="note error">{view.error}{view.rows.length > 0 ? " Showing the last list." : ""}</div>}
            <div role="status">{note && <div className={noteBad ? "note error" : "note"}>{note}</div>}</div>
            {view.rows.length === 0 && !view.error && <div className="sb-hint">Nothing in this workspace is listening on a port.</div>}
            {view.rows.map((r) => (
              <div key={rowKey(r)} className="menu-item ports-row" data-port={r.port} data-external={r.external}>
                <span className="name">
                  {r.port} <span className="reason">{openAddress(r, printed.forPort(r.port, view.rows))}</span>
                  {r.external && <span className="reason"> · external</span>}
                </span>
                <button className="btn" aria-label={`Open port ${r.port}`} title="Open in your browser" onClick={() => openRow(r)}>
                  Open
                </button>
                {!r.external && (
                  <button className="btn" aria-label={`Stop port ${r.port}`} title="Stop the process listening here" aria-disabled={stopping.includes(rowKey(r)) ? true : undefined} onClick={(e) => void stop(r, document.activeElement === e.currentTarget)}>
                    {stopping.includes(rowKey(r)) ? "Stopping…" : "Stop"}
                  </button>
                )}
              </div>
            ))}
            {capNote(view.rows) && <div className="sb-hint">{capNote(view.rows)}</div>}
          </div>
        </OutOfFlow>
      )}
    </>
  );
}
