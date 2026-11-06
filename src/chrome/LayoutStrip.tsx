// The 40 px layout strip (DESIGN.md section 6): "Layout" and the pane count of the workspace in
// front (TERM-001). The quick counts are shortcuts, and the free field takes any number up to the
// most one launch can start, so a workspace is never limited to 3, 5 or another unlisted count.
// Splits, tabs and the pane's own plus menu still add panes wherever the user wants them.
// Owner change 2026-11-06: the space freed by the New tab and Preview buttons carries the
// workspace's token and spend ribbon (usage/WorkspaceSpend.tsx).
import { useEffect, useRef, useState } from "react";
import { MAX_PANES, PANE_COUNTS } from "../terminal/grid";
import WorkspaceSpend from "../usage/WorkspaceSpend";

type Props = { count: number; onLayout: (n: number) => void; workspace?: string | null };

export default function LayoutStrip({ count, onLayout, workspace = null }: Props) {
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
      <div className="layouts" role="group" aria-label="Panes per screen">
        {PANE_COUNTS.map((n) => (
          <button key={n} aria-pressed={count === n} onClick={() => onLayout(n)} title={n === 1 ? "One pane" : `${n} panes: empty panes are added, unstarted ones removed`}>
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
      {/* The workspace's token and spend ribbon sits at the right end of the strip. */}
      <span className="strip-right" style={{ marginLeft: "auto" }}>
        <WorkspaceSpend workspace={workspace} />
      </span>
    </div>
  );
}
