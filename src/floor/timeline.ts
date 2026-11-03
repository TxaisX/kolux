// VIEW-013: the Floor timeline's rules as pure functions, so they are tested without a window.
// One lane per agent pane; its state changes (from activity_timeline) become coloured segments
// clamped to the chosen range.

export type Mark = { at: number; state: string };
/** `parent` (T-260-b) is the pane of the session this one was started under, when there is one. */
export type Track = { pane: number; marks: Mark[]; ended: number | null; terminal: number | null; live: boolean; parent?: number | null };
export type Kind = "working" | "needs" | "idle" | "unverifiable";
export type Segment = { kind: Kind; from: number; to: number };
export type Range = "15m" | "60m" | "today";

export const RANGES: { id: Range; label: string }[] = [
  { id: "15m", label: "15 minutes" },
  { id: "60m", label: "60 minutes" },
  { id: "today", label: "Today" },
];

/** Where the axis starts: today is local midnight, not 24 hours back. */
export function rangeStart(range: Range, now: number): number {
  if (range === "15m") return now - 15 * 60_000;
  if (range === "60m") return now - 60 * 60_000;
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Blocked and waiting both read needs-you. */
export function kindOf(state: string): Kind {
  if (state === "working") return "working";
  if (state === "permission" || state === "waiting" || state === "blocked" || state === "needs-input") return "needs";
  return "idle";
}

/** A lane's segments within [from, to]. A lane whose terminal is gone cannot vouch for its quiet
 * stretches, so they read unverifiable instead of idle. Nothing is drawn after the pane closed. */
export function segments(t: Track, from: number, to: number): Segment[] {
  const out: Segment[] = [];
  const end = Math.min(to, t.ended ?? to);
  t.marks.forEach((m, i) => {
    let kind = kindOf(m.state);
    if (kind === "idle" && !t.live) kind = "unverifiable";
    const a = Math.max(from, m.at);
    const b = Math.min(end, t.marks[i + 1]?.at ?? end);
    if (b <= a) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.to === a) last.to = b;
    else out.push({ kind, from: a, to: b });
  });
  return out;
}

/** Six evenly spaced ticks along the axis, both ends included. */
export const ticks = (from: number, to: number) => Array.from({ length: 6 }, (_, i) => from + ((to - from) * i) / 5);

/** Lanes with something inside the range, in pane order, each child session right under its
 * parent and one step in (T-260-b). A child whose parent has no lane in the range, or whose parent
 * chain loops back on itself, stays on top; no lane is shown twice. */
export function lanes(tracks: Track[], from: number, to: number) {
  const shown = [...tracks]
    .sort((a, b) => a.pane - b.pane)
    .map((t) => ({ track: t, segs: segments(t, from, to) }))
    .filter((l) => l.segs.length > 0);
  const panes = new Set(shown.map((l) => l.track.pane));
  const link = new Map(shown.map((l) => [l.track.pane, l.track.parent != null && l.track.parent !== l.track.pane && panes.has(l.track.parent) ? l.track.parent : null]));
  const onLoop = (pane: number) => {
    let at = link.get(pane) ?? null;
    for (let i = 0; at !== null && i <= shown.length; i++) {
      if (at === pane) return true;
      at = link.get(at) ?? null;
    }
    return false;
  };
  const parentOf = (l: (typeof shown)[number]) => (onLoop(l.track.pane) ? null : (link.get(l.track.pane) ?? null));
  const out: Array<(typeof shown)[number] & { depth: number }> = [];
  const seen = new Set<number>();
  const place = (l: (typeof shown)[number], depth: number) => {
    if (seen.has(l.track.pane)) return;
    seen.add(l.track.pane);
    out.push({ ...l, depth });
    shown.filter((c) => parentOf(c) === l.track.pane).forEach((c) => place(c, depth + 1));
  };
  shown.filter((l) => parentOf(l) === null).forEach((l) => place(l, 0));
  return out;
}

/** FIX-2: the Floor indents a nested lane by its depth up to this many levels, then stops. */
export const INDENT_LIMIT = 5;
export const indent = (depth: number): number => Math.min(depth, INDENT_LIMIT);

/** When a re-read fails but earlier lanes are still on screen, they are old: say so instead of showing them as live. */
export const staleNote = (error: string | null, haveTracks: boolean): string | null => (error !== null && haveTracks ? "These lanes are from the last successful reading and may be out of date." : null);
