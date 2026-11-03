// VIEW-013: the Floor page. One lane per agent pane with coloured segments for working, needs-you
// and idle over the chosen range, and six time ticks along the axis.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Segmented } from "../settings/GeneralPage";
import { indent, lanes, RANGES, rangeStart, staleNote, ticks, type Kind, type Range, type Track } from "./timeline";

const COLOUR: Record<Kind, string> = { working: "var(--working)", needs: "var(--warn)", idle: "var(--line-strong)", unverifiable: "var(--line-subtle)" };
const WORD: Record<Kind, string> = { working: "Working", needs: "Needs you", idle: "Idle", unverifiable: "Unverifiable" };
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// onOpen (T-035-b): a live lane is a button that jumps to that agent's pane in the Code view.
type Props = { initial?: Track[]; now?: number; load?: () => Promise<Track[]>; onOpen?: (pane: number) => void };

export default function FloorView({ initial, now: fixed, load = () => invoke<Track[]>("activity_timeline"), onOpen }: Props) {
  const [range, setRange] = useState<Range>("60m");
  const [tracks, setTracks] = useState<Track[]>(initial ?? []);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(fixed ?? Date.now());
  useEffect(() => {
    if (initial) return;
    const tick = () =>
      load().then(
        (t) => {
          setTracks(t);
          setError(null);
          setNow(Date.now());
        },
        (e) => setError(String(e)),
      );
    tick();
    const id = setInterval(tick, 5_000);
    return () => clearInterval(id);
  }, []);
  const stale = staleNote(error, tracks.length > 0);
  const from = rangeStart(range, now);
  const shown = lanes(tracks, from, now);
  const pct = (ms: number) => `${(ms / (now - from)) * 100}%`;
  // FIX-1: the name column is 110px plus one 14px step per level of the deepest nested lane, shared by
  // every lane and the axis so the bars stay in line; a longer name is cut and keeps its full text as a tooltip.
  // FIX-2: the indent stops at five levels (timeline INDENT_LIMIT), so a very deep chain cannot eat the bar.
  const gutter = 110 + 14 * Math.max(0, ...shown.map((r) => indent(r.depth)));
  const nameOf = (track: Track) => `${track.terminal === null ? `Pane ${track.pane}` : `Terminal ${track.terminal}`}${track.live ? "" : " (closed)"}`;
  return (
    <section className="floor" aria-label="Floor" style={{ padding: "16px 20px", color: "var(--fg)", overflow: "auto", height: "100%" }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15, flex: 1 }}>Floor</h2>
        <Segmented<Range> label="Time range" options={RANGES} value={range} onPick={setRange} />
      </header>
      <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--fg-muted)", marginBottom: 8 }}>
        {(Object.keys(WORD) as Kind[]).map((k) => (
          <span key={k}>
            <span style={{ display: "inline-block", width: 10, height: 10, background: COLOUR[k], marginRight: 4, borderRadius: 2 }} />
            {WORD[k]}
          </span>
        ))}
      </div>
      {error && <p className="muted">The Floor could not be read: {error}</p>}
      {stale && (
        <p className="muted" role="status">
          {stale}
        </p>
      )}
      {!error && shown.length === 0 && <p className="muted">No agent reported any activity in this range. An agent gets a lane here once it runs in a Kolux pane: start one with New session, or pick a longer range.</p>}
      {shown.map(({ track, segs, depth }) => (
        <div key={track.pane} className="floor-lane" data-depth={depth} data-stale={stale ? "" : undefined} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, opacity: stale ? 0.5 : 1 }}>
          <span className="floor-name" title={nameOf(track)} style={{ width: gutter, boxSizing: "border-box", paddingLeft: indent(depth) * 14, flexShrink: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {depth > 0 ? "↳ " : ""}
            {onOpen && track.live ? (
              <button type="button" className="floor-jump" data-pane={track.pane} title="Open in Code: go to this agent's pane" aria-label={`Open in Code: ${track.terminal === null ? `Pane ${track.pane}` : `Terminal ${track.terminal}`}`} onClick={() => onOpen(track.pane)} style={{ font: "inherit", padding: 0, border: 0, background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer" }}>
                {track.terminal === null ? `Pane ${track.pane}` : `Terminal ${track.terminal}`}
              </button>
            ) : (
              track.terminal === null ? `Pane ${track.pane}` : `Terminal ${track.terminal}`
            )}
            {track.live ? "" : " (closed)"}
          </span>
          <div style={{ position: "relative", flex: 1, height: 14, background: "var(--chip-bg)", borderRadius: 3 }}>
            {segs.map((s) => (
              <span key={s.from} className={`floor-seg floor-${s.kind}`} title={`${WORD[s.kind]} ${clock(s.from)} to ${clock(s.to)}`} data-ms={s.to - s.from} style={{ position: "absolute", top: 0, bottom: 0, left: pct(s.from - from), width: pct(s.to - s.from), background: COLOUR[s.kind], borderRadius: 2 }} />
            ))}
          </div>
        </div>
      ))}
      <div className="floor-axis" style={{ position: "relative", marginLeft: gutter + 8, height: 18, fontSize: 11, color: "var(--fg-faint)" }}>
        {ticks(from, now).map((t, i) => (
          <span key={i} className="floor-tick" style={{ position: "absolute", left: pct(t - from), transform: i === 0 ? "none" : i === 5 ? "translateX(-100%)" : "translateX(-50%)" }}>
            {clock(t)}
          </span>
        ))}
      </div>
    </section>
  );
}
