// Model routing (SET-028): pick a provider, then a model and an effort for each worker tier.
// When a coordinator starts a worker on a tier (`kolux-dev orchestration worker-start --tier`),
// the worker runs on that provider with the model picked here. Only providers that can route by
// tier are listed, installed or not; one this computer lacks carries a "Not detected" mark
// (ACCT-034). Reset puts back the chosen provider's ladder only. ponytail: shown as a page of its
// own until Settings > Agents exists (T-036, T-054).
import { useEffect, useState, type KeyboardEvent } from "react";
import { tabStep } from "../chrome/RightSidebar";
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "../launch/PlusMenu";
import { chooseModel, current, effortsFor, isCustom, resetProvider, routingOf, TIERS, withPick, type Provider } from "./routing";

type Props = {
  /** The detected agents, for the not-detected mark. */
  agents: AgentInfo[];
  settings: Record<string, unknown>;
  onSettings: (next: Record<string, unknown>) => void;
  /** Seeds the catalogue without asking the back end (tests render it to HTML). */
  initial?: Provider[];
};

export default function RoutingPage({ agents, settings, onSettings, initial }: Props) {
  const [providers, setProviders] = useState<Provider[] | null>(initial ?? null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState(initial?.[0]?.id ?? "claude");

  useEffect(() => {
    if (initial) return;
    invoke<Provider[]>("routing_catalog")
      .then(setProviders)
      .catch((e) => setError(String(e)));
  }, [initial]);

  const p = providers?.find((x) => x.id === chosen) ?? providers?.[0];
  const routing = routingOf(settings);
  const missing = (id: string) => !agents.some((a) => a.id === id && a.installed);
  // T-757: the open tab is the one tab stop; Left, Right, Home and End move along and open the tab reached.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = providers ?? [];
    const to = tabStep(all.length, all.findIndex((x) => x.id === p?.id), e.key);
    if (to === null) return;
    e.preventDefault();
    (e.currentTarget.childNodes[to] as HTMLElement).focus(); // the tabs are the list's only children
    setChosen(all[to].id);
  };

  return (
    <section className="autos routing" aria-label="Model routing">
      <div className="autos-bar">
        <h2>Model routing</h2>
        <div className="autos-agents" role="tablist" aria-label="Provider" onKeyDown={onTabKey}>
          {(providers ?? []).map((x) => (
            <button key={x.id} id={`routing-tab-${x.id}`} className="btn" role="tab" aria-selected={x.id === p?.id} aria-controls="routing-panel" tabIndex={x.id === p?.id ? 0 : -1} onClick={() => setChosen(x.id)} title={missing(x.id) ? `${x.name} was not found on this computer` : undefined}>
              {x.name}
              {missing(x.id) && <span className="routing-missing">Not detected</span>}
            </button>
          ))}
        </div>
        <span className="autos-gap" />
        {p && (
          <button className="btn" disabled={!isCustom(routing, p.id)} onClick={() => onSettings(resetProvider(settings, p.id))} title={`Put back the default model and effort for every ${p.name} tier`}>
            Reset {p.name}
          </button>
        )}
      </div>
      {error && <p className="autos-none routing-note">Model routing could not be loaded: {error}</p>}
      {p && (
        <div className="routing-body" role="tabpanel" id="routing-panel" aria-labelledby={`routing-tab-${p.id}`}>
          <p className="routing-note">A worker started on a tier runs on {p.name} with the model and effort below. Pick "Provider default" to leave the choice to {p.name}.</p>
          <table className="autos-table routing-table">
            <thead>
              <tr>
                <th>Tier</th>
                <th>Model</th>
                <th>Effort</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => {
                const now = current(p, t.id, routing);
                const efforts = effortsFor(p, now.model);
                return (
                  <tr key={t.id}>
                    <td>{t.label}</td>
                    <td>
                      <select aria-label={`${t.label} model`} className="field" value={now.model} onChange={(e) => onSettings(withPick(settings, p.id, t.id, chooseModel(p, now, e.target.value)))}>
                        <option value="">Provider default</option>
                        {p.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {efforts.length > 0 && (
                        <select aria-label={`${t.label} effort`} className="field" value={now.effort} onChange={(e) => onSettings(withPick(settings, p.id, t.id, { ...now, effort: e.target.value }))}>
                          <option value="">Default</option>
                          {efforts.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
