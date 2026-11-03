// T-153-f (VIEW-099 rest): the Resource Manager's background-session part of Manage Sessions. It lists
// the terminals the background terminal service holds that no window owns and ends them after one
// question, Keep focused (VIEW-116). Agent sessions and busy ones are never offered; nothing is
// offered until the window has loaded its workspaces. A fresh read comes first, so when every offered
// session has already ended the count just updates with no question.
import { useEffect, useState, type MutableRefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { endOffered, hostLabel, hostPlural, hostSummary, offerable, type HostSession } from "./hostSessions";

type ViewProps = { rows: HostSession[] | null; loaded: boolean; asking: HostSession[] | null; failed: string; onAsk: () => void; onEnd: () => void; onKeep: () => void };

/** What the part draws, from its state (rendered alone in tests). */
export function HostSessionsView({ rows, loaded, asking, failed, onAsk, onEnd, onKeep }: ViewProps) {
  // T-692: the question first, so an open one never goes unseen while the Resource Manager's Escape waits on it.
  if (asking) {
    const what = hostPlural(asking.length);
    return (
      <div className="res-ask res-manage" role="alertdialog" aria-label={`End ${what}`} data-host="ask">
        <span>
          End <b>{what}</b> no window owns ({asking.map(hostLabel).join(", ")})? Their shells close. Agent sessions, and sessions with a program running, are left alone.
        </span>
        <span className="btn-row">
          <button className="btn danger" onClick={onEnd}>
            {`End ${asking.length}`}
          </button>
          <button className="btn" autoFocus onClick={onKeep}>
            Keep
          </button>
        </span>
      </div>
    );
  }
  const summary = hostSummary(rows, loaded);
  if (summary === null && !failed) return null;
  const offered = offerable(rows, loaded);
  return (
    <div className="res-row res-manage" data-host={offered.length > 0 ? "offer" : "none"} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
      <span className="menu-hint">{failed ? `Background sessions: ${failed}` : summary}</span>
      {offered.length > 0 && (
        <button className="btn" onClick={onAsk} title={`End the ${hostPlural(offered.length)} the background terminal service holds that no window owns`}>
          {`End ${offered.length}`}
        </button>
      )}
    </div>
  );
}

/** The live part: reads the service's unowned sessions every two seconds while the Resource Manager is open. */
/** `question`: while the End question is open it holds the way to close it, so the Resource Manager's Escape closes the
 *  question first. Only the Resource Manager draws this, and the ref goes with the panel, so it needs no cleanup. */
export default function BackgroundSessions({ loaded, question }: { loaded: boolean; question: MutableRefObject<(() => void) | null> }) {
  const [rows, setRows] = useState<HostSession[] | null>(null);
  const [asking, setAsking] = useState<HostSession[] | null>(null);
  useEffect(() => {
    question.current = asking ? () => setAsking(null) : null;
  }, [asking, question]);
  const [failed, setFailed] = useState("");
  const read = () =>
    invoke<HostSession[]>("terminal_host_sessions")
      .then((r) => {
        const list = Array.isArray(r) ? r : [];
        setRows(list);
        setFailed("");
        return list;
      })
      .catch((e) => {
        setFailed(String(e));
        throw e;
      });
  useEffect(() => {
    void read().catch(() => {});
    const t = setInterval(() => void read().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, []);
  const ask = async () => {
    const now = offerable(await read().catch(() => null), loaded);
    setAsking(now.length > 0 ? now : null);
  };
  const end = async () => {
    const confirmed = (asking ?? []).map((h) => h.id);
    setAsking(null);
    let refused = "";
    await endOffered(confirmed, read, (id) =>
      invoke<boolean>("terminal_host_end", { id }).catch((e) => {
        refused = String(e);
        return false;
      }),
    );
    await read().catch(() => {});
    if (refused) setFailed(refused);
  };
  return <HostSessionsView rows={rows} loaded={loaded} asking={asking} failed={failed} onAsk={() => void ask()} onEnd={() => void end()} onKeep={() => setAsking(null)} />;
}
