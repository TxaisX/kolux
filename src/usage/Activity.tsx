// USAGE-011: the headline cards at the top of the Usage page: Kolux's own activity counts, kept on
// this computer since the date counting began.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { locale } from "../language";
import { Stat } from "./TokenAnalytics";

export type Counts = { since: number; agentsStarted: number; workingMs: number; prsCreated: number };

/** "14m", "3h 25m"; under a minute of work reads "<1m". */
export function workTime(ms: number): string {
  if (ms <= 0) return "0m";
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) return "<1m";
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function ActivityView({ counts }: { counts: Counts }) {
  if (counts.agentsStarted === 0) {
    return (
      <section className="conn-card" data-activity="empty">
        <p className="conn-detail">No agent has run yet. Start your first one from New session; its turns, working time and pull requests are counted here.</p>
      </section>
    );
  }
  return (
    <section className="conn-card ta-card" data-activity="counts">
      <div className="ta-stats">
        <Stat label="Agents started" value={String(counts.agentsStarted)} />
        <Stat label="Time agents spent working" value={workTime(counts.workingMs)} />
        <Stat label="Pull requests created" value={String(counts.prsCreated)} />
      </div>
      <p className="conn-detail">Counting since {new Date(counts.since).toLocaleDateString(locale(), { dateStyle: "medium" })}</p>
    </section>
  );
}

// The last counts read this session: going back to the Usage page draws them at once, then the read updates them.
let last: Counts | null = null;

export default function Activity() {
  const [counts, setCounts] = useState<Counts | null>(last);
  useEffect(() => {
    let alive = true;
    invoke<Counts>("activity_counts").then((c) => alive && setCounts((last = c)), () => alive && setCounts(last));
    return () => {
      alive = false;
    };
  }, []);
  // The first read of a session: the card's frame is drawn at once and filled when the counts arrive.
  return counts ? <ActivityView counts={counts} /> : <section className="conn-card" data-activity="loading" aria-busy="true" />;
}
