// USAGE-034: the full usage readout in an agent pane's header, right of the title and left of the
// pane buttons, in one row: the tokens used / window,
// the 5-hour and weekly plan figures each with a live countdown to its reset, and the session's
// cost in a cyan chip. The context ring and percentage (USAGE-001) were removed on 2026-11-12:
// they never picked up a real figure from the terminal. What fits is decided by the header's measured width (headerUsage.ts).
import { useEffect, useRef, useState } from "react";
import { claudeOf, codexOf } from "../usage/meter";
import { countdown } from "../usage/claude";
import { usePlan } from "../usage/plan";
import { costText, hoverLines, piecesFor, planFigure, startTicker, tokensText, windowsOf, type PlanWindow, type Readout } from "./headerUsage";

/** The readout, drawn for a given width and clock (both from the stateful wrapper below). */
export function UsageReadoutView({ readout, windows, width, now }: { readout: Readout; windows: PlanWindow[]; width?: number; now: number }) {
  const cost = costText(readout.costUsd);
  const pieces = piecesFor(width, { tokens: readout.tokens !== null, windows: windows.length, cost: cost !== null });
  if (!pieces.tokens && !pieces.plan && !pieces.cost) return null;
  return (
    <span className="usage-readout" title={hoverLines(windows, readout.left, new Date(now)).join("\n") || undefined}>
      {pieces.tokens && readout.tokens !== null && (
        <span className="usage-tokens" title="Context tokens held now / the auto handoff point">
          {tokensText(readout.tokens, readout.window)}
        </span>
      )}
      {pieces.plan &&
        windows.map((w) => {
          const f = planFigure(w, readout.left);
          return (
            <span key={w.label} className="usage-win" data-window={w.label}>
              <span className={`usage-fig ${f.tone}`.trim()}>
                {w.label} {f.text}
              </span>
              {pieces.countdowns && w.resetsAt !== null && <span className="usage-count">· {countdown(w.resetsAt, now)}</span>}
            </span>
          );
        })}
      {pieces.cost && cost !== null && (
        <span className="usage-cost" title="This session's cost so far">
          {cost}
        </span>
      )}
    </span>
  );
}

/** The readout in a pane header: measures the header it sits in (not the window, so a split pane
 * behaves), reads the account's plan windows, and ticks every 30 s so the countdowns move. */
export function HeaderUsage({ agent, readout, account }: { agent: string; readout: Readout; account?: string | null }) {
  const { claude: activeClaude, claudeBy, claudeActive, codex: active, codexBy, codexActive } = usePlan();
  // T-548-b: a Claude pane on another account shows that account's own windows (none until they are read)
  const claude = claudeActive === undefined ? activeClaude : claudeOf(agent, account, claudeActive, activeClaude, claudeBy);
  // T-548-b: a Codex pane on another account shows that account's own figures (none until they are read)
  const codex = codexActive === undefined ? active : codexOf(agent, account, codexActive, active, codexBy);
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const head = ref.current?.closest(".pane-head");
    if (!head || typeof ResizeObserver === "undefined") return;
    const read = () => setWidth(Math.round(head.getBoundingClientRect().width));
    read();
    const watch = new ResizeObserver(read);
    watch.observe(head);
    return () => watch.disconnect();
  }, []);
  useEffect(() => startTicker(setNow), []);
  const windows = windowsOf(agent, claude, codex);
  return (
    <span ref={ref} className="usage-slot">
      <UsageReadoutView readout={readout} windows={windows} width={width} now={now} />
    </span>
  );
}
