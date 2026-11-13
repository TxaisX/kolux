// One session per cell (owner decision 2026-11-12): the marks a pane's header draws in place of its old tab
// (terminal/TabMarks.tsx), worked out from the window's state. Pure, so it is tested without a window.
import type { Pane } from "../../App";
import { needsYou } from "../../board/chip";
import type { AgentState } from "../../projects/rows";
import { colorOf, type TabColors } from "../../terminal/tabColor";
import type { TabMarksData } from "../../terminal/TabMarks";
import { tabBadge } from "../../terminal/tabs";
import type { ClaudeLimit } from "../../usage/claude";
import type { CodexUsage } from "../../usage/codex";
import { contextFill, meterOf, meterText, type ContextReading } from "../../usage/meter";

export type MarksFrom = {
  pinned: ReadonlySet<number>;
  tabColors: TabColors;
  running: Record<number, boolean>;
  unreadPanes: ReadonlySet<number>;
  hook: Partial<Record<number, AgentState>>;
  status: AgentState | undefined;
  context: ContextReading | undefined;
  capped: boolean;
  claude: ClaudeLimit[];
  codex: CodexUsage | null;
};

/** The pane's marks: its Tab Color, its pin, and for a terminal its unread bell and context ring, as its tab drew them. */
export function tabMarksOf(p: Pick<Pane, "key" | "agent" | "kind" | "seats">, w: MarksFrom): TabMarksData {
  const c = colorOf(w.tabColors, p.key);
  const terminal = !p.kind && !p.seats;
  return {
    color: c && { label: c.label, css: c.css },
    pinned: w.pinned.has(p.key),
    unread: terminal && tabBadge(p.agent, w.running[p.key], needsYou(w.status), w.unreadPanes.has(p.key), w.hook[p.key]) === "unread",
    ring: terminal && w.context ? { percent: contextFill(w.context, w.capped), title: meterText(meterOf(w.context, p.agent, w.claude, w.codex, w.capped) ?? {}) } : null,
  };
}
