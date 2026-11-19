// The Agents rail and the pane chips, moved out of App.tsx as they
// were (cycle 2, the App.tsx split): VIEW-015/018/021/023, T-546. Called where they sat, so the window's hook
// order is unchanged.
import type { Pane } from "../App";
import { chipOf } from "../status/chip";
import { markFor } from "../launch/PlusMenu";
import { capOn, claudeOf, codexOf, contextFill, meterOf, meterText, planOf, readsLeft, usageLine } from "../usage/meter";
import { useClaudePaneFigures, useCodexPaneFigures } from "../usage/paneFigures";
import { pickSession, railGroups } from "./rail";
import { useEffect } from "react";
import type { WindowState } from "../shell/windowStore";
import type { Screens } from "../chrome/useScreens";

export function useRailAndTower({ accountSwitcher, agentOf, agentSel, agents, agentsScreen, context, now, panes, plan, running, setAgentSel, settings, stale, stamp, statusOf, turn }: Pick<WindowState, "accountSwitcher" | "agentOf" | "agentSel" | "agents" | "context" | "panes" | "plan" | "running" | "setAgentSel" | "settings" | "stale" | "stamp" | "statusOf" | "turn"> & Pick<Screens, "agentsScreen" | "now">) {
  // VIEW-015 / VIEW-021: the Agents rail groups sessions under the saved (switched-on, installed)
  // agents; the shown session is the remembered pick, else the first agent's newest; + adds a
  // not-started preset under that agent. VIEW-024: cards carry the saved agent's name.
  const saved = agents.filter((a) => a.installed);
  const groups = railGroups(panes, saved);
  const selected = agentsScreen ? pickSession(groups, agentSel) : agentSel;
  useEffect(() => {
    if (agentsScreen && selected !== agentSel) setAgentSel(selected);
  }, [agentsScreen, selected, agentSel]);
  const savedName = (p: Pane) => saved.find((a) => a.id === p.agentId)?.name;
  // USAGE-004 / VIEW-018: the rail's rings are the tab rings; the footer is the picked session's 5-hour window.
  const ringOf = (p: Pane) => (context[p.key] ? { percent: contextFill(context[p.key], capOn(settings)), title: meterText(meterOf(context[p.key], p.agent, claudeOf(p.agent, p.account, accountSwitcher.active.claude, plan.claude, plan.claudeBy), codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), capOn(settings)) ?? {}) } : null);
  useClaudePaneFigures(panes, accountSwitcher.active.claude); // T-548-b: the same for the Claude panes
  useCodexPaneFigures(panes, accountSwitcher.active.codex); // T-548-b: the figures of the other accounts the Codex panes run on
  const railPick = panes.find((p) => p.key === selected);
  const footer = railPick ? usageLine(railPick.seats ? markFor(railPick.agentId ?? "") : railPick.agent, claudeOf(railPick.agent, railPick.account, accountSwitcher.active.claude, plan.claude, plan.claudeBy), codexOf(railPick.agent, railPick.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), readsLeft(settings)) : "";
  const planLine = (p: Pane) => {
    const f = planOf(p.agent, claudeOf(p.agent, p.account, accountSwitcher.active.claude, plan.claude, plan.claudeBy), codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy));
    return f ? meterText({ plan: f }) : undefined;
  };
  // VIEW-023: a card's chip and lane; VIEW-025: an answer typed into the agent's own prompt.
  const chipFor = (p: Pane) => chipOf({ agent: agentOf(p), state: statusOf(p), running: running[p.key], stale: stale[p.key] ?? false, ...turn[p.key], since: stamp[p.key]?.at ?? 0 }, now);
  return {
    saved, groups, selected, savedName, ringOf, railPick, footer, planLine, chipFor,
  };
}

export type RailAndTower = ReturnType<typeof useRailAndTower>;
