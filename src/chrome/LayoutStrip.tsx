// The 40 px layout strip (DESIGN.md section 6): "Layout" and the pane count of the workspace in
// front (TERM-001). The quick counts are shortcuts, and the free field takes any number up to the
// most one launch can start, so a workspace is never limited to 3, 5 or another unlisted count.
// Splits, tabs and the pane's own plus menu still add panes wherever the user wants them.
// 2026-11-21: the token and spend ribbon that sat at the right end is gone from the window; the
// same figures are still kept and drawn in Settings > Usage (usage/TokenAnalytics.tsx).
import { useEffect, useRef, useState } from "react";
import { MAX_PANES, PANE_COUNTS } from "../terminal/grid";

type Props = { count: number; onLayout: (n: number) => void };

export default function LayoutStrip({ count, onLayout }: Props) {
  const box = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(String(count));
  // A split, a close or Start changes the count from elsewhere: follow it unless the field is being typed in.
  useEffect(() => {
    if (document.activeElement !== box.current) setDraft(String(count));
  }, [count]);
  // The free field applies on Enter or blur, not per keystroke: typing "12" must not pass through
  // a one-pane moment that drops the other panes.
  const apply = () => {
    const n = Math.floor(Number(draft));
    const want = Number.isFinite(n) ? Math.min(MAX_PANES, Math.max(1, n)) : count;
    setDraft(String(want));
    if (want !== count) onLayout(want);
  };
  return (
    <div className="strip">
      <span>Layout</span>
      <div className="layouts" role="group" aria-label="Panes per screen" data-testid="layout-strip">
        {PANE_COUNTS.map((n) => (
          <button key={n} data-testid={`layout-count-${n}`} aria-pressed={count === n} onClick={() => onLayout(n)} title={n === 1 ? "One pane" : `${n} panes. More panes: the Start form asks what to run in the new ones. Fewer: only panes not started yet close; anything running stays.`}>
            {n}
          </button>
        ))}
        <input
          ref={box}
          className="count-field"
          type="number"
          min={1}
          max={MAX_PANES}
          aria-label="Any number of panes"
          title={`Any number of panes, 1 to ${MAX_PANES}`}
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={apply}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            } else if (e.key === "Escape") {
              setDraft(String(count));
              e.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
}
