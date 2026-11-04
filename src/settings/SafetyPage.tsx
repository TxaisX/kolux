// Settings > Safety. SAFE-015: the Protected actions section. Claude Code's PreToolUse hook asks
// before a command that trips one of seven built-in rules (the check itself is protected.rs, the
// hook answer is hooks.rs); this page is the master switch and one switch per rule over the saved
// settings keys `protectedAsk` (never saved means on) and `protectedOff` (the ids switched off).
// The rule names and example commands come from Rust (`protected_rules`), so they cannot drift.
// Custom rules, per-project overrides and the recent-attempts list (T-156-b, SAFE-016..018) are
// the two sections SafetyRules.tsx draws under this one.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { hooksOn } from "./AgentsPage";
import { SafetyAttempts, SafetyRules } from "./SafetyRules";
import { useSettings } from "./useSettings";
import { SettingsError } from "./SettingsError";

export const ASK_FIELD = "protectedAsk";
export const OFF_FIELD = "protectedOff";

export type RuleInfo = { id: string; name: string; samples: string[] };
type Settings = Record<string, unknown>;

/** The master switch: on unless it was saved off. */
export const asksAtAll = (s: Settings) => s[ASK_FIELD] !== false;
/** The rule ids saved as switched off; anything else in a hand-edited file is ignored. */
export const offIds = (s: Settings): string[] => (Array.isArray(s[OFF_FIELD]) ? (s[OFF_FIELD] as unknown[]).filter((x): x is string => typeof x === "string") : []);
/** A rule asks unless its id is in the off list. */
export const ruleOn = (s: Settings, id: string) => !offIds(s).includes(id);
/** The settings patch for one rule's switch; ids this page does not draw stay in the list. */
export const switchRule = (s: Settings, id: string, on: boolean): Settings => ({ [OFF_FIELD]: on ? offIds(s).filter((x) => x !== id) : [...offIds(s).filter((x) => x !== id), id] });
/** The settings patch for the master switch. */
export const switchAll = (on: boolean): Settings => ({ [ASK_FIELD]: on });

type ViewProps = {
  settings: Settings;
  /** null while the rule list is being read. */
  rules: RuleInfo[] | null;
  /** Why the rule list could not be read. */
  error?: string | null;
  save: (patch: Settings) => unknown;
};

export function SafetyView({ settings, rules, error = null, save }: ViewProps) {
  const master = asksAtAll(settings);
  const hooks = hooksOn(settings);
  return (
    <section className="conn-card" data-section="protected" aria-label="Protected actions">
      <h2 className="conn-name">Protected actions</h2>
      <p className="conn-detail">
        Before Claude runs a command that is hard to undo, Kolux makes Claude ask you first: you allow it once or refuse it, and nothing runs until you do. Switch a rule off and Claude stops asking about that kind of command.
      </p>
      <p className="conn-detail" data-covers>
        Only Claude Code is covered; Codex and other agents are not. This is advisory, not a safety control: a command can be written around a rule.
      </p>
      <p className={hooks ? "conn-detail" : "conn-detail warn"} data-hooks-note role={hooks ? undefined : "alert"}>
        {hooks ? "Protected actions work through the agent status hooks, which are on." : "The agent status hooks are off, so Claude cannot ask yet. Turn them on in Settings > Agents."}
      </p>
      <label className="conn-switch">
        <input type="checkbox" role="switch" aria-label="Ask before protected actions" checked={master} onChange={(e) => void save(switchAll(e.target.checked))} />
        <span>
          Ask before protected actions
          <small id="safety-master-note">{master ? "On: each rule below that is switched on asks." : "Off: no rule asks, whatever its own switch says."}</small>
        </span>
      </label>
      {error && (
        <p className="conn-detail warn" role="alert">
          The rules could not be listed: {error}
        </p>
      )}
      {rules === null && !error && <p className="conn-detail">Reading the rules...</p>}
      {rules && (
        <div data-rules data-master-off={master ? undefined : ""}>
          {rules.map((r) => (
            <label className="conn-switch" key={r.id} data-rule={r.id}>
              <input type="checkbox" role="switch" aria-label={r.name} aria-describedby={master ? undefined : "safety-master-note"} checked={ruleOn(settings, r.id)} onChange={(e) => void save(switchRule(settings, r.id, e.target.checked))} />
              <span>
                {r.name}
                <small>
                  For example{" "}
                  {r.samples.map((s, i) => (
                    <span key={s}>
                      {i > 0 && ", "}
                      <code>{s}</code>
                    </span>
                  ))}
                </small>
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}

/** Saves `patch`, then reads the settings back: what is on disk once the save has settled, whether
 * it worked or not. null when they cannot be read. The page draws this, so a write that failed
 * never leaves a switch showing a state that is not saved (a rule that looks on but is off). */
export async function savedState(save: (patch: Settings) => unknown, read: () => Promise<Settings>, patch: Settings): Promise<Settings | null> {
  try {
    await save(patch);
  } catch {
    // The page already shows why the save failed.
  }
  try {
    return await read();
  } catch {
    return null;
  }
}

export default function SafetyPage() {
  const { settings, error, save, retry } = useSettings();
  const [rules, setRules] = useState<RuleInfo[] | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [disk, setDisk] = useState<Settings | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    invoke<RuleInfo[]>("protected_rules").then(setRules, (e) => setRulesError(String(e)));
  }, []);
  // After each save the page draws what a re-read finds on disk; only the newest save's re-read
  // counts. The last re-read stays on screen until the next one lands: useSettings keeps what a
  // refused save wrote, so dropping it at the start of a save would flash that wrong switch.
  const guarded = (patch: Settings) => {
    const mine = ++latest.current;
    let ok = true;
    return savedState(async (q) => void (ok = (await save(q)) !== false), () => invoke<Settings>("get_settings"), patch).then((s) => {
      if (mine === latest.current) setDisk(s);
      return ok;
    });
  };
  const shown = disk ?? settings;
  if (!shown) return <SettingsError error={error} loaded={false} onRetry={retry} />;
  return (
    <>
      <SafetyView settings={shown} rules={rules} error={rulesError} save={guarded} />
      <SafetyRules settings={shown} rules={rules} save={guarded} />
      <SafetyAttempts />
      <SettingsError error={error} loaded onRetry={retry} />
    </>
  );
}
