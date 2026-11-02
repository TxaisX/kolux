// USAGE-034: the full usage readout in an agent pane's header, right of the title and left of the
// pane buttons, in one row: the context ring and percentage (USAGE-001), the tokens used / window,
// the 5-hour and weekly plan figures each with a live countdown to its reset, and the session's
// cost in a cyan chip. What fits is decided by the header's measured width (headerUsage.ts).
import { useEffect, useRef, useState } from "react";
import Ring from "../usage/Ring";
import { claudeOf, codexOf, tone as toneOf } from "../usage/meter";
import { countdown } from "../usage/claude";
import { usePlan } from "../usage/plan";
import { costText, hoverLines, piecesFor, planFigure, startTicker, tokensText, windowsOf, type PlanWindow, type Readout } from "./headerUsage";

/** USAGE-001: the header's context ring and percentage. Always there; a greyed 0% until the
 * first reading (a real 0% is a reading), then tinted yellow from 70% and red beyond 90%. Only
 * Claude's status line reports context, so a Codex pane's hover says so instead of promising a
 * figure (stand-in review of lane/marks ee2bfbc, FIX-SOON 6). USAGE-034: with plan windows the
 * hover gains one line per window. */
export function ContextGauge({ context, agent, windows = [], left = false, now }: { context?: number | null; agent: string; windows?: PlanWindow[]; left?: boolean; now?: Date }) {
  const none = context === null || context === undefined;
  const percent = none ? 0 : Math.round(context);
  const waiting = agent === "codex" ? "Context used: Codex does not report its context to Kolux, so there is no figure to show." : "Context used: nothing received yet. The figure appears with the agent's first status report.";
  const title = none ? (agent === "shell" ? "Context used (agents only)" : waiting) : `Context used: ${percent}% of the agent's context window`;
  // The tint reads the real figure: 90.4% is beyond 90 though it shows as 90% (stand-in review of
  // lane/marks 243736d, AFTER 9).
  return (
    <span className={none ? "gauge none" : `gauge ${toneOf(context ?? 0)}`.trim()} title={hoverLines(title, windows, left, now).join("\n")}>
      <Ring percent={percent} />
      {percent}%
    </span>
  );
}

/** The readout, drawn for a given width and clock (both from the stateful wrapper below). */
export function UsageReadoutView({ context, agent, readout, windows, width, now }: { context?: number | null; agent: string; readout: Readout; windows: PlanWindow[]; width?: number; now: number }) {
  const cost = costText(readout.costUsd);
  const pieces = piecesFor(width, { tokens: readout.tokens !== null, windows: windows.length, cost: cost !== null });
  return (
    <span className="usage-readout">
      <ContextGauge context={context} agent={agent} windows={windows} left={readout.left} now={new Date(now)} />
      {pieces.tokens && readout.tokens !== null && (
        <span className="usage-tokens" title="Context tokens used / the context window">
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
export function HeaderUsage({ context, agent, readout, account }: { context?: number | null; agent: string; readout: Readout; account?: string | null }) {
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
      <UsageReadoutView context={context} agent={agent} readout={readout} windows={windows} width={width} now={now} />
    </span>
  );
}
