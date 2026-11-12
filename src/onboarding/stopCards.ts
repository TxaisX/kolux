// ONB-024: the setup card an Explore Kolux stop carries, as pure rules. tasks and PR view show
// GitHub, agent statuses shows a keep-the-computer-awake switch, ship shows the commit message
// writer, usage shows which agents are connected (T-321-c), and the orchestration stop
// shows the skill its feature needs with the installer command to set it up (T-321-c).
import { awakeMode, type AwakeMode } from "../launch/KeepAwakeCard";
import { hooksOn } from "./hooksOn";
import { WRITER_COMMAND_KEY, writerOf, type Writer } from "../scm/generate";

/** How an agent counts as connected on the usage stop: through a managed account, the Claude 1-year key,
 *  or the agent's own default sign-in / rate-limit data even before live quota arrives (ONB-024). */
export type Via = "accounts" | "key" | "default" | "none";
export type UsageRow = { agent: "claude" | "codex"; label: string; connected: boolean | null; via: Via };
export type SkillCardData = { skill: string; label: string; about: string; ready: boolean | null };

export type StopCard =
  | { kind: "provider"; connected: boolean | null; label: string }
  | { kind: "usage"; rows: UsageRow[]; anyConnected: boolean | null }
  | { kind: "skill"; skill: SkillCardData }
  | { kind: "awake"; mode: AwakeMode; on: boolean; hooksOff: boolean }
  | { kind: "writer"; writer: Writer; hasCommand: boolean };

/** What the two account lists answer (the parts the usage stop reads). */
export type ClaudeFacts = { accounts: unknown[]; keyMode: boolean };
export type CodexFacts = { accounts: unknown[]; systemDefault: string };
/** `claude` / `codex` are null until that account list has been read; `claudeLimits` is the rate-limit
 *  windows Claude Code last reported (null until read). */
export type UsageFacts = { claude: ClaudeFacts | null; codex: CodexFacts | null; claudeLimits: unknown[] | null };
/** `homeSkills` is the skill names found in an agent's own folder, null until the scan arrives. */
export type StopFacts = { taskSource: boolean | null; settings: Record<string, unknown> | null; usage?: UsageFacts | null; homeSkills?: string[] | null };

/** The Kolux skill each skill stop needs: orchestration teaches agents to hand work to others. */
export const STOP_SKILLS: Readonly<Record<string, { skill: string; label: string; about: string }>> = {
  orchestration: { skill: "orchestration", label: "Orchestration skill", about: "Lets one agent hand work to others and wait for their results." },
};

/** Claude counts as connected through a managed account, the 1-year key, or the rate-limit data Claude Code
 *  itself reported (its own default sign-in). Null while the account list has not been read. */
export function claudeVia(c: ClaudeFacts | null, limits: unknown[] | null): { connected: boolean | null; via: Via } {
  if (!c) return { connected: null, via: "none" };
  if (c.accounts.length > 0) return { connected: true, via: "accounts" };
  if (c.keyMode) return { connected: true, via: "key" };
  if (limits && limits.length > 0) return { connected: true, via: "default" };
  // The limits are still being read: do not say "not connected" yet.
  return limits === null ? { connected: null, via: "none" } : { connected: false, via: "none" };
}

/** Codex counts as connected through a managed account or a ChatGPT sign-in made outside Kolux (the
 *  system default). An API key or a custom provider has no plan limits, so it does not count here. */
export function codexVia(c: CodexFacts | null): { connected: boolean | null; via: Via } {
  if (!c) return { connected: null, via: "none" };
  if (c.accounts.length > 0) return { connected: true, via: "accounts" };
  if (c.systemDefault === "chatgpt") return { connected: true, via: "default" };
  return { connected: false, via: "none" };
}

export function usageCard(u: UsageFacts | null | undefined): StopCard {
  const claude = claudeVia(u?.claude ?? null, u?.claudeLimits ?? null);
  const codex = codexVia(u?.codex ?? null);
  const rows: UsageRow[] = [
    { agent: "claude", label: "Claude", ...claude },
    { agent: "codex", label: "Codex", ...codex },
  ];
  const any = rows.some((r) => r.connected === true) ? true : rows.some((r) => r.connected === null) ? null : false;
  return { kind: "usage", rows, anyConnected: any };
}

/** The skill card of a stop; `ready` is null until the skills scan has answered. */
export function skillCard(stop: string, homeSkills: string[] | null | undefined): StopCard | null {
  const s = STOP_SKILLS[stop];
  if (!s) return null;
  return { kind: "skill", skill: { ...s, ready: homeSkills ? homeSkills.includes(s.skill) : null } };
}

/** Inline setup terminals are shorter inside onboarding than in the tour (ONB-024). */
export const ONBOARDING_TERMINAL_HEIGHT = 150;

/** The card a stop carries, or null when it has none yet. The two settings cards wait for the saved
 *  settings, so a switch is never drawn from a guessed default and written back over what is saved. */
export function stopCard(stop: string, f: StopFacts): StopCard | null {
  if (stop === "usage") return usageCard(f.usage);
  if (STOP_SKILLS[stop]) return skillCard(stop, f.homeSkills);
  if (stop === "tasks" || stop === "pr") return { kind: "provider", connected: f.taskSource, label: stop === "tasks" ? "Tasks come from GitHub" : "Pull requests come from GitHub" };
  if (!f.settings) return null;
  if (stop === "statuses") {
    const mode = awakeMode(f.settings);
    // Agent mode follows the agent status hooks; with them off it holds nothing (the Settings page says so too).
    return { kind: "awake", mode, on: mode !== "off", hooksOff: mode === "agent" && !hooksOn(f.settings) };
  }
  if (stop === "ship") {
    const command = f.settings[WRITER_COMMAND_KEY];
    return { kind: "writer", writer: writerOf(f.settings), hasCommand: typeof command === "string" && command.trim() !== "" };
  }
  return null;
}

/** The keep-awake switch: off turns on its automatic mode (Agent); either on mode can be switched off. */
export const awakeToggle = (mode: AwakeMode): AwakeMode => (mode === "off" ? "agent" : "off");

/** What the commit-writer switch writes when it is turned back on: what it had before it went off (an agent
 *  or custom). With nothing remembered, a saved command means the user had picked custom. A custom writer
 *  needs its command, so with none it is Claude. */
export function writerBack(before: string | null, hasCommand: boolean): string {
  const want = before ?? (hasCommand ? "custom" : "claude");
  return want === "custom" && !hasCommand ? "claude" : want;
}
