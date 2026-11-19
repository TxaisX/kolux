// What is left of the Agents rail (the Agents screen and its control tower are gone), moved out of App.tsx as it
// was (cycle 2, the App.tsx split): VIEW-024's saved agent name on a pane, and the usage figures of the other
// accounts the panes run on (T-548-b). Called where it sat, so the window's hook order is unchanged.
import type { Pane } from "../App";
import { useClaudePaneFigures, useCodexPaneFigures } from "../usage/paneFigures";
import type { WindowState } from "../shell/windowStore";

export function useRailAndTower({ accountSwitcher, agents, panes }: Pick<WindowState, "accountSwitcher" | "agents" | "panes">) {
  // VIEW-024: a pane carries the saved (switched-on, installed) agent's name.
  const saved = agents.filter((a) => a.installed);
  const savedName = (p: Pane) => saved.find((a) => a.id === p.agentId)?.name;
  useClaudePaneFigures(panes, accountSwitcher.active.claude); // T-548-b: the same for the Claude panes
  useCodexPaneFigures(panes, accountSwitcher.active.codex); // T-548-b: the figures of the other accounts the Codex panes run on
  return {
    savedName,
  };
}

export type RailAndTower = ReturnType<typeof useRailAndTower>;
