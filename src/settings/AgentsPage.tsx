// Settings > Agents (SET-027): which agents are switched on, the default one, and how each starts.
import { useContext, useEffect, useState } from "react";
import { SearchFolds } from "./search";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import type { AgentInfo } from "../launch/PlusMenu";
import AgentPicker from "../launch/AgentPicker";
import { defaultChoices, DEFAULT_EFFORT_KEY, DEFAULT_MODEL_KEY, seatDefault } from "../launch/defaultSeat";
import { DEFAULT_AGENT_KEY, defaultAgentId, disabledAgents, switchAgent } from "../launch/agents";
import { Segmented } from "./GeneralPage";
import { useSettings } from "./useSettings";
import { settingsDiff } from "./saveChanged";
import { GeneratedTitlesCard } from "../status/GeneratedTitlesCard";
import { useDraft } from "./useDraft";
import TeamsModeCard from "../launch/TeamsModeCard";
import KeepAwakeCard from "../launch/KeepAwakeCard";
import { useTeamsHost } from "../launch/teams";
import { CAP_FIELD, capOn } from "../usage/meter";
import { CACHE_LENGTH, CACHE_ON, cacheMinutes } from "../projects/cache";
import { HOOKS_FIELD, hooksOn } from "../onboarding/hooksOn";

const OPTIONS_FIELD = "agentOptions";
const PERMISSIONS_FIELD = "agentPermissions";
type Options = { command?: string; args?: string; env?: string };
type StartLine = { args: string[]; program: string | null };

const optionsOf = (s: Record<string, unknown>, id: string): Options => ((s[OPTIONS_FIELD] as Record<string, Options> | undefined)?.[id] ?? {}) as Options;

/** A text field kept as a draft while typing and saved when it loses focus. */
function Draft({ label, value, multi, placeholder, onSave }: { label: string; value: string; multi?: boolean; placeholder: string; onSave: (v: string) => Promise<boolean> }) {
  const { props: typing } = useDraft(value, onSave); // SET-036: saves after a pause, on leaving, on page change
  const props = { "aria-label": label, className: multi ? "field multi" : "field", placeholder, ...typing };
  return (
    <label className="agent-field">
      <span>{label}</span>
      {multi ? <textarea {...props} rows={3} /> : <input {...props} />}
    </label>
  );
}

// Settings > Agents: the 200k context cap switch (USAGE-006, on by default). A plain settings
// key; the cap itself is applied in Rust when a Claude or Codex pane starts.
export function AgentsPageView({ cap, onCap }: { cap: boolean; onCap: (on: boolean) => void }) {
  return (
    <section className="conn-card" aria-label="Agents">
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={cap} onChange={(e) => onCap(e.target.checked)} />
        <span>
          Hold Claude and Codex to a 200k context window
          <small>
            On unless you turn it off; sessions started from now on follow it. Claude Code compacts at 200k and Codex is given a 200k window that compacts at 180k. A session you set up yourself (the
            variable, or Codex options, a profile or OSS mode on the start line) is left alone, and the meters measure against the same 200k while this is on.
          </small>
        </span>
      </label>
    </section>
  );
}

// STAT-002: one switch for every agent's status hooks. Rust takes Kolux's entries out (or puts them
// back) when `agent_hooks_sync` runs after the save.
// FIX-2: the key and the rule live in src/onboarding/hooksOn.ts (T-152-gate: only a saved true installs; DT-C52:
// the switch starts on, and the answer to the consent line is the recorded approval to write hooks); re-exported
// so existing importers keep working.
export { HOOKS_FIELD, hooksOn };

// T-152-c (3): `agent_hooks_sync` answers with one {agent, done, error} per agent; the errors are
// shown beside the switch so a refused install or a failed removal never stays silent.
export const hookProblems = (reply: unknown): string[] =>
  Array.isArray(reply) ? reply.filter((o) => o && typeof o.error === "string").map((o) => `${o.agent}: ${o.error}`) : [];

export function HooksSwitch({ on, onSwitch, file, problems = [] }: { on: boolean; onSwitch: (on: boolean) => void; file?: string; problems?: string[] }) {
  return (
    <section className="conn-card" aria-label="Agent status hooks" data-section="hooks">
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => onSwitch(e.target.checked)} />
        <span>
          Agent status hooks
          {problems.map((p) => <small className="warn" role="alert" data-problem key={p}>{p}</small>)}
          <small>Agents tell Kolux when they work, wait for you or finish. On once you have answered the line in setup: on adds Kolux's hooks to each agent's settings; off removes them and stops them being put back; your own hooks stay.</small>
          {file && <small data-file>Claude Code settings: {file}</small>}
        </span>
      </label>
    </section>
  );
}

export default function AgentsPage() {
  const { settings, error, save: write } = useSettings();
  const found = useContext(SearchFolds); // SET-007: a search that matches a launch line opens its fold
  const [written, setWritten] = useState(0);
  const save = (patch: Record<string, unknown>) => write(patch).then((ok) => (setWritten((n) => n + 1), ok));
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const teamsHost = useTeamsHost();
  const [looking, setLooking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null); // SESS-002: an errored search is not an empty one
  const [lines, setLines] = useState<Record<string, string>>({});
  const [hooksFile, setHooksFile] = useState<string>();
  const [problems, setProblems] = useState<string[]>([]);
  const synced = (reply: unknown) => setProblems(hookProblems(reply));
  const syncFailed = (e: unknown) => setProblems([String(e)]);
  useEffect(() => {
    invoke<string>("agent_hooks_file").then(setHooksFile, () => {});
  }, []);
  const refresh = () => {
    setLooking(true);
    invoke<AgentInfo[]>("agent_list")
      .then((list) => {
        setAgents(list);
        setFailed(null);
        void emit("agents-changed", list);
      })
      .catch((e) => setFailed(String(e) || "the search failed"))
      .finally(() => setLooking(false));
  };
  useEffect(refresh, []);
  useEffect(() => {
    const off = listen<AgentInfo[] | null>("agents-changed", (e) => Array.isArray(e.payload) && setAgents(e.payload));
    return () => void off.then((u) => u()).catch(() => {});
  }, []);
  const installed = (agents ?? []).filter((a) => a.installed);
  // What each installed agent starts as with the saved options, read again after every save.
  useEffect(() => {
    if (!settings) return;
    void Promise.all(installed.map((a) => invoke<StartLine>("agent_start_line", { id: a.id, extra: [], prompt: "" }).then((l) => [a.id, [l.program ?? a.program, ...l.args].map((x) => (/\s/.test(x) || x === "" ? `"${x}"` : x)).join(" ")] as const))).then((all) => setLines(Object.fromEntries(all)));
  }, [written, agents, settings === null]);
  if (!settings) return error ? <p className="conn-detail warn">{error}</p> : null;

  const off = disabledAgents(settings);
  const def = defaultAgentId(settings);
  const choices = installed.filter((a) => !off.includes(a.id));
  const savedMissing = def !== "" && !choices.some((a) => a.id === def);
  const nameOf = (id: string) => (agents ?? []).find((a) => a.id === id)?.name ?? id;
  const setOption = (id: string, k: keyof Options, v: string) => {
    const all = { ...((settings[OPTIONS_FIELD] as Record<string, Options> | undefined) ?? {}) };
    all[id] = { ...optionsOf(settings, id), [k]: v };
    return save({ [OPTIONS_FIELD]: all });
  };
  const yolo = settings[PERMISSIONS_FIELD] !== "manual";
  const seatNow = seatDefault(settings);
  const seatChoices = defaultChoices();

  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      <section className="conn-card" data-section="default">
        <h2 className="conn-name">Default agent</h2>
        <select aria-label="default agent" className="field" value={savedMissing ? `saved:${def}` : def} onChange={(e) => save({ [DEFAULT_AGENT_KEY]: e.target.value.replace(/^saved:/, "") })}>
          <option value="">Auto: the first agent available</option>
          {savedMissing && <option value={`saved:${def}`}>{nameOf(def)} (saved, not found right now)</option>}
          {choices.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="conn-detail">A new agent tab opens with this agent and its options below. Switching the default agent off leaves no default.</p>
      </section>

      <section className="conn-card" data-section="seat-default">
        <h2 className="conn-name">Default model and effort</h2>
        <select aria-label="default model" className="field" value={seatNow.model} onChange={(e) => save({ [DEFAULT_MODEL_KEY]: e.target.value })}>
          <option value="">No default: pick a model for each seat</option>
          {seatChoices.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <select aria-label="default effort" className="field" value={seatNow.effort} onChange={(e) => save({ [DEFAULT_EFFORT_KEY]: e.target.value })} disabled={seatNow.model === ""}>
          <option value="">Model default effort</option>
          {seatChoices.efforts.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <p className="conn-detail">Every new seat starts on this model and effort, and you can change either on the seat. An agent that does not offer the model starts on its own default.</p>
      </section>

      <section className="conn-card" data-section="permissions">
        <h2 className="conn-name">Agent Permissions</h2>
        <Segmented label="Agent Permissions" options={[{ id: "yolo", label: "Yolo" }, { id: "manual", label: "Manual" }]} value={yolo ? "yolo" : "manual"} onPick={(v) => save({ [PERMISSIONS_FIELD]: v })} />
        <p className="conn-detail">{yolo ? "Agents start with the switches that skip their permission prompts, where they have one (Claude Code in its automatic mode, Codex without approvals)." : "Agents ask before they change things."} An agent with its own default arguments below is left as you set it.</p>
      </section>

      <section className="conn-card" data-section="agents">
        <div className="conn-head">
          <h2 className="conn-name">Installed agents</h2>
          <button className="btn conn-add" onClick={refresh} disabled={looking}>
            {looking ? "Looking…" : "Refresh"}
          </button>
        </div>
        {failed ? (
          <p className="conn-detail warn" role="alert">
            Kolux could not look for agent CLIs ({failed}). Press Refresh to try again.
          </p>
        ) : (
          agents !== null && installed.length === 0 && <p className="conn-detail">No agent CLI was found. Install one, then press Refresh.</p>
        )}
        {installed.map((a) => {
          const o = optionsOf(settings, a.id);
          const on = !off.includes(a.id);
          return (
            <div key={a.id} className="agent-row" data-agent={a.id}>
              <label className="agent-on">
                {/* T-598: only the keys the switch changes; the page's copy can be older than the disk */}
                <input type="checkbox" role="switch" checked={on} onChange={(e) => void save(settingsDiff(settings, switchAgent(settings, a.id, e.target.checked)).set).then(() => invoke("agent_hooks_sync")).then(synced, syncFailed)} />
                <span className="agent-name">{a.name}</span>
                {a.id === def && on && <span className="conn-chip">default</span>}
              </label>
              <details open={found?.has("how-it-starts") || undefined}>
                <summary>How it starts</summary>
                <code className="agent-line">{lines[a.id] ?? ""}</code>
                <Draft label="Command" value={o.command ?? ""} placeholder={a.path ?? a.program} onSave={(v) => setOption(a.id, "command", v)} />
                <Draft label="Default arguments" value={o.args ?? ""} placeholder={a.args.length ? `${a.args.join(" ")} (built in; yours replace these)` : "none"} onSave={(v) => setOption(a.id, "args", v)} />
                <Draft label="Environment" multi value={o.env ?? ""} placeholder="NAME=value, one per line" onSave={(v) => setOption(a.id, "env", v)} />
              </details>
            </div>
          );
        })}
      </section>
      {agents !== null && agents.length > 0 && <AgentPicker agents={agents} onChanged={(list) => (setAgents(list), void emit("agents-changed", list))} />}
      <HooksSwitch on={hooksOn(settings)} file={hooksFile} problems={problems} onSwitch={(on) => void save({ [HOOKS_FIELD]: on }).then(() => invoke("agent_hooks_sync", { clear: !on })).then(synced, syncFailed)} />
      <AgentsPageView cap={capOn(settings ?? {})} onCap={(on) => void save({ [CAP_FIELD]: on })} />
      <TeamsModeCard settings={settings} save={save} host={teamsHost} />
      <KeepAwakeCard settings={settings} save={save} />
      <GeneratedTitlesCard settings={settings} save={save} />
      <CachePick minutes={cacheMinutes(settings)} onPick={(m) => void save(m === null ? { [CACHE_ON]: false } : { [CACHE_ON]: true, [CACHE_LENGTH]: m })} />
    </>
  );
}

// SET-059: the prompt-cache countdown switch (off by default) and its length, matched to how long
// the provider keeps the cache; minutes, or null for off.
export function CachePick({ minutes, onPick }: { minutes: number | null; onPick: (m: number | null) => void }) {
  return (
    <section className="conn-card" aria-label="Prompt-cache timer">
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={minutes !== null} onChange={(e) => onPick(e.target.checked ? 5 : null)} />
        <span>
          Prompt-cache timer
          <small>When a Claude agent goes idle, its worktree card counts down how long the conversation stays cached; after that the next message sends it all again without the cache.</small>
        </span>
      </label>
      <div className="look-select">
        <span>Cache length</span>
        <select aria-label="Cache length" className="field" disabled={minutes === null} value={String(minutes ?? 5)} onChange={(e) => onPick(Number(e.target.value))}>
          <option value="5">5 minutes</option>
          <option value="60">1 hour</option>
        </select>
      </div>
    </section>
  );
}
