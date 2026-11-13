// One session per cell (owner decision 2026-11-12): what a pane's tab in the old per-cell strip showed, drawn in
// the pane's own header now, just before its title: the Tab Color dot (TERM-133), the pin (TERM-046), the unread
// bell (TERM-055 / TERM-118: a finish or bell while the pane was out of view) and the context ring (USAGE-003, fed
// by the agent's own status line; nothing is drawn until it reports). The other tab badges (working, needs you,
// done, stopped) are what the header's status dot and status word already say, so they are not drawn twice.
// Every pane kind's header draws them through HeadMarks, and the drag grip (TERM-015) through HeadGrip, from the
// pane's PaneHead context (shell/window/Pane.tsx provides it), so no pane component threads them through its props
// and the memoised terminal pane does not draw again when only a mark changes.
import { createContext, useContext } from "react";
import { Pin } from "../chrome/icons";
import Ring from "../usage/Ring";
import PaneGrip from "./PaneGrip";
import { TabBadge } from "./tabName";

export type TabMarksData = {
  color: { label: string; css: string } | null;
  pinned: boolean;
  unread: boolean;
  ring: { percent: number; title: string } | null;
};

export default function TabMarks({ marks: m }: { marks: TabMarksData }) {
  return (
    <>
      {m.color && <span className="tab-dot" role="img" aria-label={`Tab Color: ${m.color.label}`} title={`Tab Color: ${m.color.label}`} style={{ background: m.color.css }} />}
      {m.pinned && (
        <span className="tab-pin" role="img" aria-label="Pinned" title="Pinned" data-pinned="true">
          <Pin size={10} />
        </span>
      )}
      {m.unread && <TabBadge kind="unread" />}
      {m.ring && <Ring percent={m.ring.percent} size={10} title={m.ring.title} />}
    </>
  );
}

/** What the window hands one pane's header: its tab marks, and its grip while the grid has more than one cell. */
export type PaneHead = { marks: TabMarksData | null; grip: { name: string; onStart: () => void; onEnd: () => void } | null };
export const PaneHeadContext = createContext<PaneHead>({ marks: null, grip: null });

/** The tab marks of the pane whose header this is; nothing outside the window's grid (a pane drawn on its own). */
export function HeadMarks() {
  const { marks } = useContext(PaneHeadContext);
  return marks ? <TabMarks marks={marks} /> : null;
}

/** The drag grip of the pane whose header this is, first in the header; nothing in a one-cell grid. */
export function HeadGrip() {
  const { grip } = useContext(PaneHeadContext);
  return grip ? <PaneGrip name={grip.name} onStart={grip.onStart} onEnd={grip.onEnd} /> : null;
}
