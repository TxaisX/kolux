// The Agents screen's rail (VIEW-015, VIEW-021): sessions under each saved agent, + adds a
// not-started preset, and an empty state when no agent is switched on.
import { Fragment } from "react";
import { Plus } from "../chrome/icons";
import VendorMark from "../chrome/VendorMark";
import { markFor } from "../launch/PlusMenu";
import Ring from "../usage/Ring";
import { OTHER, sessionLabel, type Group, type RowStatus, type Session } from "./rail";

type Props<S extends Session> = { groups: Group<S>[]; selected: number | null; classic: boolean; statusOf: (p: S) => RowStatus; ringOf: (p: S) => { percent: number; title: string } | null; footer: string; onSelect: (key: number) => void; onAdd: (agentId: string) => void; onSettings: () => void; taskOf?: (key: number) => string | undefined };

export default function AgentsRail<S extends Session>({ groups, selected, classic, statusOf, ringOf, footer, onSelect, onAdd, onSettings, taskOf }: Props<S>) {
  const look = classic ? " classic" : "";
  return (
    <div className={`sidebar-wrap rail-wrap${look}`}>
      <nav className={`sidebar rail${look}`} aria-label="Sessions by agent">
        {groups.length === 0 ? (
          <div className="empty">
            <h2>No agents yet</h2>
            <p>None is installed and switched on. Install one or switch one on in Settings to start a session.</p>
            <button className="btn" onClick={onSettings}>
              Open Settings
            </button>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.id} className="rail-group" data-agent={g.id} aria-label={g.name}>
              <div className="proj">
                <span className="name">{g.name}</span>
                {g.id !== OTHER && (
                  <button className="ib" aria-label={`Add a ${g.name} session`} title={`Add a ${g.name} session`} onClick={() => onAdd(g.id)}>
                    <Plus size={14} />
                  </button>
                )}
              </div>
              {g.sessions.map((p) => {
                const st = statusOf(p);
                const ring = ringOf(p);
                return (
                <Fragment key={p.key}>
                <div className={`sess${p.key === selected ? " sel" : ""}${p.seats ? " pending" : ""}`} role="button" tabIndex={0} data-session={p.key} aria-current={p.key === selected ? "true" : undefined} onClick={() => onSelect(p.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(p.key); } }}>
                  <VendorMark agent={markFor(p.agentId ?? g.id, p.program)} size={13} />
                  <span className="name">{p.seats ? "New session" : sessionLabel(p, taskOf?.(p.key))}</span>
                  {ring && <Ring percent={ring.percent} size={10} title={ring.title} />}
                  <span className={`status${st.tone ? ` ${st.tone}` : ""}`} data-tip={st.explain}>
                    {st.word}
                  </span>
                </div>
                {st.line && <div className="sess-line" style={{ paddingLeft: 49 }} title={st.line} data-session-line={p.key}>{st.line}</div>}
                </Fragment>
                );
              })}
            </section>
          ))
        )}
        {footer && (
          <div className="rail-foot" title="The picked session's plan: its 5-hour window and when it resets">
            {footer}
          </div>
        )}
      </nav>
    </div>
  );
}
