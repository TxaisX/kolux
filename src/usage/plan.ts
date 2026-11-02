// The plan figures the window knows (USAGE-005): the two top-bar pills read them and publish
// here, so Board cards can show their agent's figures without a second read.
import { useEffect, useState, useSyncExternalStore } from "react";
import { nextTick, type ClaudeLimit } from "./claude";
import type { CodexUsage } from "./codex";
import { accountKey, type ClaudeByAccount, type CodexByAccount } from "./meter";

export type Plan = {
  claude: ClaudeLimit[];
  codex: CodexUsage | null;
  /** T-548-b: the Claude windows read for the accounts other than the active one that a pane runs on. */
  claudeBy?: ClaudeByAccount;
  /** T-548-b: the account new Claude panes use (null = Claude's own sign-in); unset until the window has published it. */
  claudeActive?: string | null;
  /** `codexBy` (T-548-b): the Codex figures read for the accounts other than the active one that a pane runs on. */
  codexBy?: CodexByAccount;
  /** T-548-b: the account new Codex panes use (null = the system default); unset until the window has published it. */
  codexActive?: string | null;
};

let plan: Plan = { claude: [], codex: null };
const subs = new Set<() => void>();
const publish = (next: Plan) => {
  plan = next;
  subs.forEach((f) => f());
};
export const publishClaude = (claude: ClaudeLimit[]) => publish({ ...plan, claude });
/** T-548-b: the active Claude account, for readers that do not have it at hand (the pane header). */
export const publishClaudeActive = (claudeActive: string | null) => plan.claudeActive !== claudeActive && publish({ ...plan, claudeActive });
/** T-548-b: stores (limits) or drops (null) the windows read for one account, `null` id = Claude's own sign-in. */
export const publishClaudeFor = (id: string | null, limits: ClaudeLimit[] | null) => {
  const { [accountKey(id)]: _gone, ...rest } = plan.claudeBy ?? {};
  publish({ ...plan, claudeBy: limits ? { ...rest, [accountKey(id)]: limits } : rest });
};
export const publishCodex = (codex: CodexUsage | null) => publish({ ...plan, codex });
/** T-548-b: the active Codex account, for readers that do not have it at hand (the pane header). */
export const publishCodexActive = (codexActive: string | null) => plan.codexActive !== codexActive && publish({ ...plan, codexActive });
/** T-548-b: stores (usage) or drops (null) the figures read for one account, `null` id = the system default sign-in. */
export const publishCodexFor = (id: string | null, usage: CodexUsage | null) => {
  const { [accountKey(id)]: _gone, ...rest } = plan.codexBy ?? {};
  publish({ ...plan, codexBy: usage ? { ...rest, [accountKey(id)]: usage } : rest });
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
const read = () => plan;
/** The figures as they stand, for code outside React (USAGE-023: a failed read keeps them). */
export const readPlan = (): Plan => plan;

export const usePlan = (): Plan => useSyncExternalStore(subscribe, read, read);

/** USAGE-024: re-renders the caller each time the nearest of these resets (ms) changes its countdown. */
export function useResetTick(resets: (number | null | undefined)[]): void {
  const [, bump] = useState(0);
  const key = resets.join(",");
  useEffect(() => {
    const at = key.split(",").map((r) => (r ? Number(r) : null));
    let timer: number | undefined;
    const arm = () => {
      const ms = nextTick(at);
      if (ms !== null) timer = window.setTimeout(() => (bump((n) => n + 1), arm()), ms);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [key]);
}
