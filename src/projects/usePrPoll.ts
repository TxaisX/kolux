// GIT-027 / GIT-028: every shown workspace's pull request, polled in the background: the visible
// workspace first, one gh call per GitHub project, a round every few minutes while the window is
// shown (backing off after failures, waiting out a rate limit), and again on focus when stale.
// STAT-038: an agent finishing in a listed workspace brings the next round forward, once per finish.
// Moved unchanged out of ProjectsPanel.tsx.
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { mergePoll, nextDelay, pollItems, STALE_MS, type PrPoll } from "../scm/poll";
import { recordPoll } from "../scm/prSearch";
import { onFinish, REFRESH_AFTER_MS, wantsRefresh } from "../status/finished";
import type { PrState } from "./rows";

/** Each polled path's pull request state; `paths` are the folders the sidebar shows, `active` the shown one. */
export function usePrPoll(paths: string[], active: string | null, links: Record<string, string>): Record<string, PrState> {
  const [prBy, setPrBy] = useState<Record<string, PrState>>({});
  const polled = useRef({ failures: 0, at: 0, next: 0, limited: 0 });
  const pollKey = JSON.stringify([paths, active, links]);
  useEffect(() => {
    if (paths.length === 0) return;
    const st = polled.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dead = false;
    const later = (ms: number) => {
      clearTimeout(timer);
      st.next = Date.now() + ms;
      timer = setTimeout(round, ms);
    };
    const round = () => {
      if (document.hidden) return later(60_000);
      invoke<PrPoll>("scm_prs_poll", { items: pollItems(paths, active, links) })
        .then((answer) => {
          if (dead) return;
          setPrBy((prev) => mergePoll(prev, answer));
          recordPoll(answer); // VIEW-043: the palette lists these pull requests
          st.failures = answer.prs.some((x) => x.error !== null) ? st.failures + 1 : 0;
          st.at = Date.now();
          st.limited = answer.limitedUntil ?? 0;
          later(nextDelay(st.failures, answer.limitedUntil, Date.now()));
        })
        .catch(() => {
          if (dead) return;
          st.failures += 1;
          later(nextDelay(st.failures, null, Date.now()));
        });
    };
    later(Math.max(1500, st.next - Date.now()));
    const focus = () => {
      if (Date.now() - st.at > STALE_MS && st.limited * 1000 < Date.now()) later(0);
    };
    window.addEventListener("focus", focus);
    const off = onFinish((cwd) => wantsRefresh({ hidden: document.hidden, paths, cwd, limitedUntil: st.limited, now: Date.now() }) && later(REFRESH_AFTER_MS));
    return () => {
      dead = true;
      clearTimeout(timer);
      off();
      window.removeEventListener("focus", focus);
    };
  }, [pollKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return prBy;
}
