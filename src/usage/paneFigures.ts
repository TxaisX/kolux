// T-548-b (OD-11): plan figures for the Codex accounts that panes run on but that are not the active
// one. The active account's figures come from the Codex pill (codex_usage); every other account a
// Codex pane is on is read here with codex_usage_of, one slow reader per account (a read starts a
// helper process, so the same pace as the pill: every five minutes, a focus at most every two).
import { useEffect, useRef } from "react";
import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ClaudeLimit } from "./claude";
import type { CodexUsage } from "./codex";
import { accountKey } from "./meter";
import { publishClaudeActive, publishClaudeFor, publishCodexActive, publishCodexFor } from "./plan";
import { claudeFetched, codexFetched, runner } from "./refresh";

const FOCUS_MS = 2 * 60_000;

/** The accounts to read: the distinct accounts of the panes of `agent` (Codex unless told otherwise) that are
 *  not the active one, in the order the panes appear. A pane with no recorded account (undefined) is unknown
 *  and asks for nothing. */
export function accountsToRead(panes: Array<{ agent: string; account?: string | null }>, active: string | null, agent: "codex" | "claude" = "codex"): Array<string | null> {
  const out: Array<string | null> = [];
  for (const p of panes) {
    if (p.agent !== agent || p.account === undefined || p.account === active) continue;
    if (!out.includes(p.account)) out.push(p.account);
  }
  return out;
}

/** Keeps one reader per wanted account running and drops the figures of an account no pane needs any more. */
export function useCodexPaneFigures(panes: Array<{ agent: string; account?: string | null }>, active: string | null): void {
  const wanted = accountsToRead(panes, active);
  const key = wanted.map((a) => (a === null ? "\u0000" : a)).join("\u0001");
  useEffect(() => void publishCodexActive(active), [active]);
  const held = useRef<Array<string | null>>([]);
  useEffect(() => {
    const ids = key === "" ? [] : key.split("\u0001").map((a) => (a === "\u0000" ? null : a));
    // an account no pane runs on any more loses its figures; the others keep theirs while they are read again
    held.current.filter((h) => !ids.includes(h)).forEach((h) => publishCodexFor(h, null));
    held.current = ids;
    const runners = ids.map((id) =>
      runner<CodexUsage>({
        name: `codex-of:${accountKey(id)}`,
        fetch: () => invoke<CodexUsage>("codex_usage_of", { account: id }).then(codexFetched),
        focusDebounceMs: FOCUS_MS,
        onOk: (u) => publishCodexFor(id, u),
        // The figures already shown stay through a failure (USAGE-023).
      }),
    );
    runners.forEach((r) => r.start());
    return () => runners.forEach((r) => r.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

type Call = (command: string, args?: unknown) => Promise<unknown>;

/** T-548-b: the windows Claude Code last reported from one account's config folder (`null` = Claude's own
 *  sign-in, no folder). An account that is no longer listed has no folder to read, so no windows. */
export async function readClaudeOf(id: string | null, call: Call = (c, a) => invoke(c, a as InvokeArgs | undefined)): Promise<ClaudeLimit[]> {
  let configDir: string | null = null;
  if (id !== null) {
    const view = (await call("claude_accounts")) as { accounts: Array<{ id: string; configDir: string }> };
    const listed = view.accounts.find((a) => a.id === id);
    if (!listed) return [];
    configDir = listed.configDir;
  }
  return (await call("claude_usage_of", { configDir })) as ClaudeLimit[];
}

/** T-548-b: the Claude twin of useCodexPaneFigures. The active account's windows come from the Claude pill
 *  (claude_usage); every other account a Claude pane is on is read with claude_usage_of, one reader per account
 *  at the pill's pace (every five minutes, a focus at most every two) and again on each status-line report
 *  (the `claude-usage` event does not say which folder it came from, so each reader asks again; it is a store read). */
export function useClaudePaneFigures(panes: Array<{ agent: string; account?: string | null }>, active: string | null): void {
  const wanted = accountsToRead(panes, active, "claude");
  const key = wanted.map((a) => (a === null ? "\u0000" : a)).join("\u0001");
  useEffect(() => void publishClaudeActive(active), [active]);
  const held = useRef<Array<string | null>>([]);
  useEffect(() => {
    const ids = key === "" ? [] : key.split("\u0001").map((a) => (a === "\u0000" ? null : a));
    // an account no pane runs on any more loses its windows; the others keep theirs while they are read again
    held.current.filter((h) => !ids.includes(h)).forEach((h) => publishClaudeFor(h, null));
    held.current = ids;
    const runners = ids.map((id) =>
      runner<ClaudeLimit[]>({
        name: `claude-of:${accountKey(id)}`,
        fetch: () => readClaudeOf(id).then(claudeFetched),
        focusDebounceMs: FOCUS_MS,
        onOk: (l) => publishClaudeFor(id, l),
        // The windows already shown stay through a failure (USAGE-023).
      }),
    );
    runners.forEach((r) => r.start());
    let gone = false;
    const stops: Array<() => void> = [];
    if (ids.length) {
      listen("claude-usage", () => ids.forEach((id) => void readClaudeOf(id).then((l) => !gone && l.length && publishClaudeFor(id, l), () => {})))
        .then((un) => (gone ? un() : stops.push(un)))
        .catch(() => {});
    }
    return () => {
      gone = true;
      stops.forEach((s) => s());
      runners.forEach((r) => r.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
