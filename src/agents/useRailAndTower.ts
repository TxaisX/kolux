// The Agents rail, the Board's chips and lanes and the control tower's figures, moved out of App.tsx as they
// were (cycle 2, the App.tsx split): VIEW-015/018/021/023, T-546. Called where they sat, so the window's hook
// order is unchanged.
import type { Pane } from "../App";
import { LANES, chipOf } from "../board/chip";
import { markFor } from "../launch/PlusMenu";
import { switcherLabel } from "../switcher/accounts";
import { tabName } from "../terminal/tabName";
import { useTowerBridge } from "../tower/TowerWindow";
import { nameSeats, nameUsage, usageByAccount } from "../tower/tower";
import { capOn, claudeOf, codexOf, contextFill, meterOf, meterText, planOf, readsLeft, usageLine } from "../usage/meter";
import { useClaudePaneFigures, useCodexPaneFigures } from "../usage/paneFigures";
import { cardPanes, pickSession, railGroups } from "./rail";
import { useEffect, useMemo } from "react";
import type { WindowState } from "../shell/windowStore";
import type { Screens } from "../chrome/useScreens";
import type { PaneActions } from "../terminal/paneActions";

export function useRailAndTower({ accountSwitcher, agentOf, agentSel, agents, agentsScreen, board, context, guess, hook, liveIds, now, openPane, panes, plan, running, setAgentSel, settings, stale, stamp, statusOf, titles, turn }: Pick<WindowState, "accountSwitcher" | "agentOf" | "agentSel" | "agents" | "context" | "guess" | "hook" | "liveIds" | "panes" | "plan" | "running" | "setAgentSel" | "settings" | "stale" | "stamp" | "statusOf" | "titles" | "turn"> & Pick<Screens, "agentsScreen" | "board" | "now"> & Pick<PaneActions, "openPane">) {
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
  const laneOf = (p: Pane) => (p.seats || p.kind || agentOf(p) === "shell" ? "idle" : (chipFor(p)?.lane ?? "idle"));
  // T-546: the control tower reads the same chip and meter per agent pane as the Board.
  // FIX-6 (council d2 carry-over): built only when one of the things it reads changed, not on every render; `now` moves the chips on its 30 s tick.
  const towerNow = useMemo(() => panes.filter((p) => !p.kind && !p.seats && agentOf(p) !== "shell").map((p) => ({ key: p.key, agent: agentOf(p), title: tabName(p, titles), branch: p.branch, cwd: p.cwd, account: p.account, chip: chipFor(p), meter: meterOf(context[p.key], p.agent, claudeOf(p.agent, p.account, accountSwitcher.active.claude, plan.claude, plan.claudeBy), codexOf(p.agent, p.account, accountSwitcher.active.codex, plan.codex, plan.codexBy), capOn(settings)), since: stamp[p.key]?.at ?? 0 })), [panes, titles, context, plan, settings, hook, guess, running, stale, turn, stamp, now, accountSwitcher.active.codex, accountSwitcher.active.claude, liveIds]);
  // T-546-c: the Tower's own window shows the same seats and usage; a row clicked there opens the pane here.
  // T-548 FIX-1: the figures are worked out on account ids, then the Tower is shown the names the switcher shows.
  const towerUsage = useMemo(() => nameUsage(usageByAccount(towerNow, plan, accountSwitcher.active), (agent, id) => switcherLabel(accountSwitcher.groups, agent, id)), [towerNow, plan, accountSwitcher.active, accountSwitcher.groups]);
  const towerSeats = useMemo(() => nameSeats(towerNow, (agent, id) => switcherLabel(accountSwitcher.groups, agent, id)), [towerNow, accountSwitcher.groups]);
  useTowerBridge({ seats: towerSeats, usage: towerUsage }, openPane);
  const lanes = board ? LANES.filter((l) => cardPanes(panes).some((p) => laneOf(p) === l.id)) : [];
  const columnOf = (p: Pane) => lanes.findIndex((l) => l.id === laneOf(p)) + 1;
  return {
    saved, groups, selected, savedName, ringOf, railPick, footer, planLine, chipFor, laneOf, towerNow, towerUsage, towerSeats, lanes, columnOf,
  };
}

export type RailAndTower = ReturnType<typeof useRailAndTower>;
