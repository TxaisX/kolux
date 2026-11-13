// Model routing (SET-028): pick a provider, then a model and an effort for each worker tier.
// When a coordinator starts a worker on a tier (`kolux-dev orchestration worker-start --tier`),
// the worker runs on that provider with the model picked here. Only providers that can route by
// tier are listed, installed or not; one this computer lacks carries a "Not detected" mark
// (ACCT-034). Reset puts back the chosen provider's ladder only. ponytail: shown as a page of its
// own until Settings > Agents exists (T-036, T-054).
import { useEffect, useState } from "react";
import { Tab, TabList, TabPanel, Tabs } from "../ui/Tabs";
import { invoke } from "@tauri-apps/api/core";
import type { AgentInfo } from "../launch/PlusMenu";
import { chooseModel, current, effortsFor, isCustom, resetProvider, routingOf, TIERS, withPick, type Provider } from "./routing";
import { Select } from "../ui/Select";

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
  return (
    <Tabs value={p?.id ?? null} onValue={setChosen}>
    <section className="autos routing" aria-label="Model routing">
      <div className="autos-bar">
        <h2>Model routing</h2>
        {/* T-757: a src/ui tab strip: the open tab is the one tab stop, Left, Right, Home and End move along the tabs
            and open the one reached, and the open tab labels the panel below. */}
        <TabList className="autos-agents" label="Provider">
          {(providers ?? []).map((x) => (
            <Tab key={x.id} value={x.id} selected={x.id === p?.id} className="btn" title={missing(x.id) ? `${x.name} was not found on this computer` : undefined}>
              {x.name}
              {missing(x.id) && <span className="routing-missing">Not detected</span>}
            </Tab>
          ))}
        </TabList>
        <span className="autos-gap" />
        {p && (
          <button className="btn" disabled={!isCustom(routing, p.id)} onClick={() => onSettings(resetProvider(settings, p.id))} title={`Put back the default model and effort for every ${p.name} tier`}>
            Reset {p.name}
          </button>
        )}
      </div>
      {error && <p className="autos-none routing-note">Model routing could not be loaded: {error}</p>}
      {p && (
        <TabPanel value={p.id} className="routing-body">
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
                      <Select label={`${t.label} model`} value={now.model} onChange={(v) => onSettings(withPick(settings, p.id, t.id, chooseModel(p, now, v)))} options={[{ value: "", label: "Provider default" }, ...p.models.map((m) => ({ value: m.id, label: m.label }))]} className="field" />
                    </td>
                    <td>
                      {efforts.length > 0 && (
                        <Select label={`${t.label} effort`} value={now.effort} onChange={(v) => onSettings(withPick(settings, p.id, t.id, { ...now, effort: v }))} options={[{ value: "", label: "Default" }, ...efforts.map((level) => ({ value: level, label: level }))]} className="field" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TabPanel>
      )}
    </section>
    </Tabs>
  );
}
