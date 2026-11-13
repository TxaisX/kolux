// T-549 (OD-15): a roadmap view of a GitHub Project drawn as a timeline: one row per item, a bar from
// its start to its end, month marks along the top and a line for today. Items without dates are
// listed under the timeline. Which fields give the start and the end is the user's to change.
import { useMemo } from "react";
import type { ProjectField, ProjectItem } from "./projects";
import { barPlace, dayString, defaultTimeline, itemSpan, monthTicks, timelineFields, timelineRange, todayNumber } from "./timeline";
import { Select } from "../ui/Select";

export default function Timeline({ fields, items, saved, onPick }: { fields: ProjectField[]; items: ProjectItem[]; saved: unknown; onPick: (pick: { start: string; end: string }) => void }) {
  const pick = defaultTimeline(fields, saved);
  const usable = timelineFields(fields);
  const today = todayNumber();
  const placed = useMemo(() => {
    if (!pick) return { rows: [], undated: items };
    const rows: { item: ProjectItem; span: { from: number; to: number } }[] = [];
    const undated: ProjectItem[] = [];
    for (const item of items) {
      const span = itemSpan(item, fields, pick);
      if (span) rows.push({ item, span });
      else undated.push(item);
    }
    rows.sort((a, b) => a.span.from - b.span.from || a.span.to - b.span.to);
    return { rows, undated };
  }, [items, fields, pick?.start, pick?.end]);
  if (!pick) {
    return (
      <div className="note" role="status" data-timeline-none>
        This roadmap has no date or iteration field, so there is nothing to place on a timeline. Add a date or an iteration field on GitHub.
      </div>
    );
  }
  const range = timelineRange(
    placed.rows.map((r) => r.span),
    today,
  );
  const ticks = monthTicks(range);
  const now = barPlace({ from: today, to: today }, range);
  const choose = (which: "start" | "end", id: string) => onPick({ ...pick, [which]: id });
  return (
    <div className="timeline" data-timeline>
      <div className="projects-bar timeline-pick">
        {(["start", "end"] as const).map((which) => (
          <label key={which} className="tasks-filter">
            <span>{which === "start" ? "Starts at" : "Ends at"}</span>
            <Select label={which === "start" ? "Start field" : "End field"} value={pick[which]} onChange={(v) => choose(which, v)} options={usable.map((f) => ({ value: f.id, label: f.name }))} className="field" />
          </label>
        ))}
        <span className="tasks-count">
          {placed.rows.length} on the timeline{placed.undated.length ? ` · ${placed.undated.length} without dates` : ""}
        </span>
      </div>
      <div className="timeline-body">
        <div className="timeline-grid">
          <div className="timeline-head">
            {ticks.map((t) => (
              <span key={t.day} className="timeline-tick" style={{ left: `${barPlace({ from: t.day, to: t.day }, range).left}%` }}>
                {t.label}
              </span>
            ))}
          </div>
          <div className="timeline-rows">
            <span className="timeline-today" title={`Today, ${dayString(today)}`} style={{ left: `${now.left}%` }} />
            {placed.rows.map(({ item, span }) => {
              const at = barPlace(span, range);
              const when = span.from === span.to ? dayString(span.from) : `${dayString(span.from)} to ${dayString(span.to)}`;
              return (
                <div key={item.id} className="timeline-row" data-item={item.id}>
                  <span className="timeline-name" title={item.title}>
                    {item.title}
                    {item.number !== null && <span className="tasks-kind"> #{item.number}</span>}
                  </span>
                  <span className="timeline-lane">
                    {item.url ? (
                      <a className={`timeline-bar ${item.kind} ${item.state}`} href={item.url} target="_blank" rel="noreferrer" aria-label={`${item.title}, ${when}`} title={`${item.title}: ${when}`} style={{ left: `${at.left}%`, width: `${at.width}%` }} />
                    ) : (
                      <span className={`timeline-bar ${item.kind}`} title={`${item.title}: ${when}`} style={{ left: `${at.left}%`, width: `${at.width}%` }} />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {placed.undated.length > 0 && (
          <details className="timeline-undated" data-undated>
            <summary>{placed.undated.length === 1 ? "1 item without dates" : `${placed.undated.length} items without dates`}</summary>
            <ul>
              {placed.undated.map((i) => (
                <li key={i.id}>{i.kind === "restricted" ? <em>Restricted item</em> : i.title}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
