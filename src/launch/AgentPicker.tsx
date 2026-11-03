// T-579: "Install coding agents", a checklist over agent_list. Every installable agent that is not on this PC
// starts ticked; "Install selected (N)" sends the ticked ones in one agents_install_many call and each row
// follows the "agent-install-progress" event. The rules live in pickerRules.ts; AgentPickerView only draws.
import { createElement, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentInfo } from "./PlusMenu";
import {
  afterBatch, applyEvent, INSTALL_MANY, installLabel, isTicked, mergeResults, PROGRESS_EVENT, queueAll, rowWords, running, selectAll, selectedCount, selectedIds, startTicks, websiteOnly,
  type InstallResult, type Progress, type ProgressEvent,
} from "./pickerRules";

export type PickerViewProps = {
  agents: AgentInfo[];
  ticks: string[];
  progress: Progress;
  busy: boolean;
  error?: string | null;
  /** 2 on the Settings page, 3 inside a wizard step. */
  level?: 2 | 3;
  onToggle: (id: string, on: boolean) => void;
  onAll: () => void;
  onNone: () => void;
  onInstall: () => void;
  onWebsite: (id: string) => void;
};

export function AgentPickerView({ agents, ticks, progress, busy, error, level = 2, onToggle, onAll, onNone, onInstall, onWebsite }: PickerViewProps) {
  const n = selectedCount(agents, ticks, progress);
  return (
    <section className="conn-card agent-picker" aria-label="Install coding agents" data-section="install-agents">
      {createElement(`h${level}`, { className: "conn-name" }, "Install coding agents")}
      <ul className="agent-pick-list">
        {agents.map((a) => {
          const words = rowWords(a, progress);
          const failed = progress[a.id]?.state === "failed";
          const ticked = isTicked(a, ticks, progress);
          return (
            <li key={a.id} className="agent-pick-row" data-agent={a.id}>
              <label className="conn-switch" title={a.install ?? undefined}>
                <input type="checkbox" checked={ticked} disabled={a.installed || busy || websiteOnly(a)} onChange={(e) => onToggle(a.id, e.target.checked)} />
                <span>{a.name}</span>
              </label>
              {websiteOnly(a) ? (
                <button type="button" className="btn small" onClick={() => onWebsite(a.id)}>
                  Install from its website
                </button>
              ) : (
                words && (
                  <span className={`agent-pick-state${failed ? " warn" : words === "Installed" ? " ok" : ""}`} role="status" data-state={progress[a.id]?.state ?? "installed"}>
                    {words}
                  </span>
                )
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
      <div className="btn-row">
        <button type="button" className="btn" disabled={busy} onClick={onAll}>
          Select all
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onNone}>
          Select none
        </button>
        <button type="button" className="btn primary" disabled={busy || n === 0} onClick={onInstall}>
          {installLabel(n)}
        </button>
      </div>
    </section>
  );
}

/** The live checklist. `agents` is the parent's list; `onChanged` hands back the refreshed list when a batch ends. */
export default function AgentPicker({ agents, onChanged, level }: { agents: AgentInfo[]; onChanged: (list: AgentInfo[]) => void; level?: 2 | 3 }) {
  const [ticks, setTicks] = useState<string[]>(() => startTicks(agents));
  const [progress, setProgress] = useState<Progress>({});
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const latest = useRef(agents);
  latest.current = agents;

  // The event is heard while this screen is open, even for a batch another screen started.
  useEffect(() => {
    live.current = true;
    const off = listen<ProgressEvent>(PROGRESS_EVENT, (e) => live.current && setProgress((p) => applyEvent(p, e.payload)));
    return () => {
      live.current = false;
      void off.then((u) => u()).catch(() => {});
    };
  }, []);

  const busy = starting || running(progress);
  const install = async () => {
    const ids = selectedIds(agents, ticks, progress);
    if (ids.length === 0) return;
    setError(null);
    setStarting(true);
    setProgress(queueAll(ids));
    try {
      const results = await invoke<InstallResult[]>(INSTALL_MANY, { ids });
      const list = mergeResults(latest.current, results);
      if (live.current) {
        setProgress((p) => afterBatch(p, results));
        setTicks((t) => t.filter((id) => !results.some((r) => r.id === id && r.ok)));
      }
      onChanged(list);
    } catch (e) {
      if (live.current) {
        setProgress({});
        setError(String(e) || "The install could not start.");
      }
    } finally {
      if (live.current) setStarting(false);
    }
  };

  return (
    <AgentPickerView
      agents={agents}
      ticks={ticks}
      progress={progress}
      busy={busy}
      error={error}
      level={level}
      onToggle={(id, on) => setTicks((t) => (on ? [...t.filter((x) => x !== id), id] : t.filter((x) => x !== id)))}
      onAll={() => setTicks(selectAll(agents))}
      onNone={() => setTicks([])}
      onInstall={() => void install()}
      onWebsite={(id) => void invoke("open_install_page", { agent: id }).then(() => setError(null), (e) => setError(`Could not open the agent's page: ${String(e)}`))}
    />
  );
}
