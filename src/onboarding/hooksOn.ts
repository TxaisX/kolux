// FIX-2: the one place the onboarding module reads the agent status hooks switch. stopCards used to import
// `hooksOn` from the whole Agents settings page, which pulled that page into this module's graph. The key
// and the rule are the Settings page's (STAT-002); hooksOn.test.ts checks the two agree.
// T-608: hooks are on by default with one line of consent. Only a saved true installs anything (T-152-gate's
// rule in agent_hooks/switch.rs stands), and nothing saves it before the user was shown HOOKS_LINE: on the
// wizard's Connect screen, or once in a small card for a profile that never answered (Guides.tsx).
import { invoke } from "@tauri-apps/api/core";
import { SCREENS } from "./firstRun";

export const HOOKS_FIELD = "agentStatusHooks";
export const hooksOn = (s: Record<string, unknown>): boolean => s[HOOKS_FIELD] === true;

/** T-608: the one line of consent, beside a switch that starts on. */
export const HOOKS_LINE = "Kolux will add its status hooks to each AI's settings, so it can show you which one needs you.";

/** T-608: the user answered the line once (a saved true or false); nothing saved, or something unreadable, is no answer. */
export const hooksChosen = (s: Record<string, unknown>): boolean => typeof s[HOOKS_FIELD] === "boolean";

/** T-608: where the switch starts: the saved answer, else on (also while the settings are still loading). */
export const hooksDefault = (s: Record<string, unknown> | null): boolean => (s && hooksChosen(s) ? hooksOn(s) : true);

/** T-608: the one-time card asks a profile that never answered, never while the first-run wizard is open
 *  (the wizard's own Connect screen asks then). */
export const askHooks = (s: Record<string, unknown>, wizardOpen: boolean): boolean => !wizardOpen && !hooksChosen(s);

/** T-608: moving on from the wizard's Connect screen, where the line shows, records the choice; Back does not.
 *  49-ux2: neither does "I'll do this later" (`later`), which leaves without answering the line. */
export const recordsHooks = (from: number, to: number, later = false): boolean => !later && SCREENS[from]?.id === "connect" && to > from;

/** T-608: records the answer and brings every agent in line, as the Settings switch does (save, then
 *  agent_hooks_sync; off takes Kolux's entries out). A save that fails syncs nothing. */
export const recordHooks = (on: boolean, send: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> = invoke): Promise<unknown> =>
  send("settings_patch", { set: { [HOOKS_FIELD]: on }, remove: [] }).then(() => send("agent_hooks_sync", { clear: !on }));
