// Settings > Safety, the T-156-b sections: the user's own protected rules (SAFE-016), per-project
// scopes with a reset for each (SAFE-017) and the recent-attempts list (SAFE-018). The checks and
// the attempts list are Rust (protected_custom.rs); this file is the settings patches and the views.
// Settings keys: `protectedRules` (global custom rules) and `protectedProjects` (one scope per
// project root: the rule ids off there, its own rules, and extra folders that count as it).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Ask from "../chrome/Ask";
import { offIds, type RuleInfo } from "./SafetyPage";

export const RULES_FIELD = "protectedRules";
export const PROJECTS_FIELD = "protectedProjects";

export type Kind = "starts-with" | "contains" | "regex";
export type Custom = { id: string; name: string; kind: Kind; pattern: string };
export type Scope = { off: string[]; rules: Custom[]; dirs?: string[] };
export type Attempt = { time: number; worktree: string; command: string; rule: string; outcome: "waiting" | "allowed" | "denied" };
type Settings = Record<string, unknown>;
type ProjectRow = { path: string; name: string; displayName?: string; workspacesDir?: string };

export const KINDS: { kind: Kind; label: string; hint: string }[] = [
  { kind: "starts-with", label: "Starts with", hint: "the program and its first words, any case" },
  { kind: "contains", label: "Contains", hint: "these words anywhere, any case" },
  { kind: "regex", label: "Regular expression", hint: "case-insensitive, at most 500 characters" },
];

const isCustom = (x: unknown): x is Custom => typeof x === "object" && x !== null && typeof (x as Custom).id === "string" && typeof (x as Custom).pattern === "string";
const customs = (v: unknown): Custom[] => (Array.isArray(v) ? v.filter(isCustom).map((c) => ({ ...c, name: typeof c.name === "string" ? c.name : "" })) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The global custom rules. */
export const globalRules = (s: Settings): Custom[] => customs(s[RULES_FIELD]);
/** Every project scope, keyed by project root; anything malformed reads as empty. */
export function scopes(s: Settings): Record<string, Scope> {
  const raw = s[PROJECTS_FIELD];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, Partial<Scope> | null>).map(([root, v]) => [root, { off: strings(v?.off), rules: customs(v?.rules), dirs: strings(v?.dirs) }]));
}
export const scopeOf = (s: Settings, root: string): Scope => scopes(s)[root] ?? { off: [], rules: [], dirs: [] };

const withScope = (s: Settings, root: string, scope: Scope): Settings => ({ [PROJECTS_FIELD]: { ...scopes(s), [root]: scope } });

/** The patch that adds `rule` to the global list (`root` null) or a project's own. */
export const addRule = (s: Settings, root: string | null, rule: Custom, dirs: string[] = []): Settings =>
  root === null ? { [RULES_FIELD]: [...globalRules(s).filter((r) => r.id !== rule.id), rule] } : withScope(s, root, { ...scopeOf(s, root), dirs: scopeOf(s, root).dirs?.length ? scopeOf(s, root).dirs : dirs, rules: [...scopeOf(s, root).rules.filter((r) => r.id !== rule.id), rule] });

/** The patch that removes rule `id` from the global list or a project's own. */
export const removeRule = (s: Settings, root: string | null, id: string): Settings =>
  root === null ? { [RULES_FIELD]: globalRules(s).filter((r) => r.id !== id) } : withScope(s, root, { ...scopeOf(s, root), rules: scopeOf(s, root).rules.filter((r) => r.id !== id) });

/** Whether built-in or global rule `id` asks inside project `root`: off everywhere or off there means no. */
export const onIn = (s: Settings, root: string, id: string) => !offIds(s).includes(id) && !scopeOf(s, root).off.includes(id);
/** The patch that switches rule `id` on or off for project `root` only. */
export const switchIn = (s: Settings, root: string, id: string, on: boolean, dirs: string[] = []): Settings => {
  const scope = scopeOf(s, root);
  const off = scope.off.filter((x) => x !== id);
  return withScope(s, root, { ...scope, dirs: scope.dirs?.length ? scope.dirs : dirs, off: on ? off : [...off, id] });
};

/** Reset for all projects: the built-ins back on, the global custom rules gone, per-project scopes kept. */
export const resetAll = (): Settings => ({ protectedAsk: true, protectedOff: [], [RULES_FIELD]: [] });
/** Reset for one project: its own rules and its off list gone. */
export function resetProject(s: Settings, root: string): Settings {
  const rest = { ...scopes(s) };
  delete rest[root];
  return { [PROJECTS_FIELD]: rest };
}

export const newId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Saves a new rule's patch: null once it is stored, or the sentence for a refused save (the typed text stays in the form). */
export async function saveRule(save: (patch: Settings) => unknown, patch: Settings): Promise<string | null> {
  return (await save(patch)) === false ? "The rule was not saved. What you typed is kept: press Add rule to try again." : null;
}

/** A reset button that asks first in the shared Ask dialog; `yes` loses its "Yes, " and becomes the confirm word. */
export function ResetButton({ label, onReset, yes = "Yes, reset", keep = "Keep", ariaLabel, className = "btn", title }: { label: string; onReset: () => unknown; yes?: string; keep?: string; ariaLabel?: string; className?: string; title?: string }) {
  const [asking, setAsking] = useState(false);
  const word = yes.replace(/^Yes, (.)/, (_, c: string) => c.toUpperCase());
  return (
    <>
      <button type="button" className={className} title={title} data-reset aria-label={ariaLabel} onClick={() => setAsking(true)}>
        {label}
      </button>
      {asking && <Ask title={`${ariaLabel ?? label}?`} body={null} confirm={word} cancel={keep} onConfirm={() => (setAsking(false), onReset())} onCancel={() => setAsking(false)} />}
    </>
  );
}

type RulesProps = {
  settings: Settings;
  /** The built-in rules, for the per-project switches; null while unread. */
  rules: RuleInfo[] | null;
  projects: ProjectRow[];
  /** null is "all projects". */
  scope: string | null;
  setScope: (root: string | null) => void;
  save: (patch: Settings) => unknown;
  /** Whether a pattern can be saved: null, or the sentence saying why not. */
  check: (kind: Kind, pattern: string) => Promise<string | null>;
};

export function SafetyRulesView({ settings, rules, projects, scope, setScope, save, check }: RulesProps) {
  const [kind, setKind] = useState<Kind>("starts-with");
  const [pattern, setPattern] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const project = scope === null ? null : projects.find((p) => p.path === scope);
  const dirs = project?.workspacesDir ? [project.workspacesDir] : [];
  const own = scope === null ? globalRules(settings) : scopeOf(settings, scope).rules;
  const add = async () => {
    const why = await check(kind, pattern);
    setProblem(why);
    if (why) return;
    const refused = await saveRule(save, addRule(settings, scope, { id: newId(), name: name.trim(), kind, pattern: pattern.trim() }, dirs));
    // A refused save keeps what was typed, so one more press tries again (the page above says why).
    if (refused) return setProblem(refused);
    setPattern("");
    setName("");
  };
  return (
    <section className="conn-card" data-section="custom-rules" aria-label="Your rules">
      <h2 className="conn-name">Your rules</h2>
      <p className="conn-detail">A rule of your own makes Claude ask before any command it matches. Rules for all projects apply everywhere; a project can switch any rule off for itself and add its own.</p>
      <label className="conn-detail">
        Scope{" "}
        <select aria-label="Scope" value={scope ?? ""} onChange={(e) => setScope(e.target.value === "" ? null : e.target.value)}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.path} value={p.path}>
              {p.displayName || p.name}
            </option>
          ))}
        </select>
      </label>
      {scope !== null && (
        <div data-project-switches>
          <p className="conn-detail">Switched off here only (the switches above are for every project):</p>
          {[...(rules ?? []).map((r) => ({ id: r.id, name: r.name })), ...globalRules(settings).map((r) => ({ id: r.id, name: r.name || r.pattern }))].map((r) => (
            <label className="conn-switch" key={r.id} data-rule-here={r.id}>
              <input type="checkbox" role="switch" aria-label={`${r.name} in this project`} checked={onIn(settings, scope, r.id)} disabled={offIds(settings).includes(r.id)} onChange={(e) => void save(switchIn(settings, scope, r.id, e.target.checked, dirs))} />
              <span>{r.name}</span>
            </label>
          ))}
        </div>
      )}
      <ul data-custom-rules>
        {own.length === 0 && <li className="conn-detail">No rules of your own {scope === null ? "for all projects" : "in this project"} yet.</li>}
        {own.map((r) => (
          <li key={r.id} data-custom={r.id}>
            <code>{r.pattern}</code> <small>({KINDS.find((k) => k.kind === r.kind)?.label ?? r.kind})</small> {r.name && <span>{r.name}</span>}{" "}
            <ResetButton label="Remove" ariaLabel={`Remove ${r.name || r.pattern}`} yes="Yes, remove" onReset={() => void save(removeRule(settings, scope, r.id))} />
          </li>
        ))}
      </ul>
      <form
        data-add-rule
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <select aria-label="Match" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>{" "}
        <input aria-label="Pattern" placeholder={KINDS.find((k) => k.kind === kind)?.hint} value={pattern} onChange={(e) => setPattern(e.target.value)} />{" "}
        <input aria-label="Name (optional)" placeholder="Name shown to Claude (optional)" value={name} onChange={(e) => setName(e.target.value)} />{" "}
        <button type="submit" className="btn" disabled={pattern.trim() === ""}>
          Add rule
        </button>
        {problem && (
          <p className="conn-detail warn" role="alert" data-problem>
            {problem}
          </p>
        )}
      </form>
      <div className="conn-detail">
        {scope === null ? <ResetButton label="Reset rules for all projects" onReset={() => void save(resetAll())} /> : <ResetButton label="Reset this project's rules" onReset={() => void save(resetProject(settings, scope))} />}
        <small> {scope === null ? "Built-in rules back on and your rules for all projects removed; each project's own stay." : "This project's own rules and its switched-off list removed."}</small>
      </div>
    </section>
  );
}

export function SafetyRules({ settings, rules, save }: { settings: Settings; rules: RuleInfo[] | null; save: (patch: Settings) => unknown }) {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [scope, setScope] = useState<string | null>(null);
  useEffect(() => {
    invoke<ProjectRow[]>("project_list").then(setProjects, () => setProjects([]));
  }, []);
  const check = (kind: Kind, pattern: string) => invoke<void>("protected_rule_check", { kind, pattern }).then(() => null, (e) => String(e));
  return <SafetyRulesView settings={settings} rules={rules} projects={projects} scope={scope} setScope={setScope} save={save} check={check} />;
}

const when = (ms: number) => new Date(ms).toLocaleString();

export function SafetyAttemptsView({ attempts, clear, error = null }: { attempts: Attempt[]; clear: () => unknown; error?: string | null }) {
  return (
    <section className="conn-card" data-section="attempts" aria-label="Recent attempts">
      <h2 className="conn-name">Recent attempts</h2>
      <p className="conn-detail">The last {50} commands Claude was made to ask about, newest first, kept only until Kolux closes. Secrets in a command are hidden before it is kept.</p>
      {attempts.length === 0 ? (
        <p className="conn-detail" data-empty>
          Nothing was paused yet.
        </p>
      ) : (
        <ul data-attempts>
          {attempts.map((a, i) => (
            <li key={`${a.time}-${i}`} data-outcome={a.outcome}>
              <small>
                {when(a.time)} · {a.worktree || "(no folder)"} · {a.rule} · <b>{a.outcome}</b>
              </small>
              <br />
              <code>{a.command}</code>
            </li>
          ))}
        </ul>
      )}
      {attempts.length === 0 ? (
        <button type="button" className="btn" data-clear disabled>
          Clear
        </button>
      ) : (
        <ResetButton label="Clear" ariaLabel="Clear recent attempts" yes="Yes, clear" onReset={() => void clear()} />
      )}
      {error && (
        <p className="conn-detail warn" role="alert" data-clear-error>
          {error}
        </p>
      )}
    </section>
  );
}

export function SafetyAttempts() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const load = () => invoke<Attempt[]>("protected_attempts").then(setAttempts, () => {});
    void load();
    // Every hook event raises agent-status, the same moments the list can change (SAFE-018 live refresh).
    const off = listen("agent-status", () => void load());
    return () => void off.then((f) => f());
  }, []);
  const clear = () => invoke("protected_attempts_clear").then(() => (setError(null), setAttempts([])), (e) => setError(`The list was not cleared: ${String(e)}`));
  return <SafetyAttemptsView attempts={attempts} clear={clear} error={error} />;
}
