// ONB-031 / ONB-032 / ONB-033: contextual tours. Mounted once in the window; it watches for each
// tour's surface, starts at most one tour by itself per launch on a profile that qualifies, and
// runs replays asked for through replayTour (the help menu). The rules live in tour.ts.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { markGuide, type GuideRecord } from "./guide";
import { features, hasUsed, noteUse } from "./features";
import { actionWord, autoStarts, FOCUSED_SPLIT, GRID_TRIES, gaveUp, gridStarts, handsOver, lookAt, START_GRID, nextShown, ownerOff, place, prevShown, progress, REPLAY_TOUR, replayOf, stepWords, targetsOf, TOURS, tourFeature, type Placed, type Rect, type Tour, type TourId, type TourStep, type Want } from "./tour";


/** The first copy of `sel` that is really on screen (hidden copies are passed over). */
function shown(sel: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (el.checkVisibility?.() ?? true)) return el;
  }
  return null;
}

/** The first place a step can point at that is on screen: its target, then its fallbacks in order (ONB-033). */
const stepEl = (st: TourStep): HTMLElement | null => {
  for (const t of targetsOf(st)) {
    const el = shown(t);
    if (el) return el;
  }
  return null;
};

/** Where the user is, as far as the window shows it: a change means they moved to another page (ONB-032). */
const pageKey = () => [".board", "[data-tasks]", ".autos:not(.tasks)"].filter((q) => shown(q)).join("|");

/** Another dialog (the first-run wizard, a confirmation) holds the window. */
const blocked = () => [...document.querySelectorAll("[role=dialog]")].some((d) => !d.classList.contains("tour"));

const SPLIT_KEY = (e: KeyboardEvent) => e.shiftKey && (e.ctrlKey || e.altKey) && e.key.toLowerCase() === "d";

function TourPanel({ tour, at, onAt, onEnd }: { tour: Tour; at: number; onAt: (i: number) => void; onEnd: (how: "done" | "skipped" | "lost") => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState<{ t: Rect; p: Placed } | null>(null);
  const step = tour.steps[at];
  const present = tour.steps.map((s) => !!stepEl(s));
  const revealed = useRef<number | null>(null);
  const next = nextShown(present, at);
  const back = prevShown(present, at);

  // Follow the target every frame (frames stop by themselves while the window is hidden); state
  // changes only when something moved. A target gone for good moves on, or ends the tour.
  useLayoutEffect(() => {
    let frame = 0;
    let key = "";
    let missing = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const el = stepEl(step);
      if (!el) {
        // ONB-033: a step whose target is behind a hidden control clicks that control once (the sidebar's toggle).
        if (step.reveal && revealed.current !== at) {
          revealed.current = at;
          shown(step.reveal)?.click();
        }
        if (++missing < 10) return;
        cancelAnimationFrame(frame);
        const n = nextShown(tour.steps.map((s) => !!stepEl(s)), at);
        return n === null ? onEnd("lost") : onAt(n);
      }
      missing = 0;
      const t = el.getBoundingClientRect();
      const host = el.closest("[role=dialog]:not(.tour)")?.getBoundingClientRect();
      const b = host ?? { left: 8, top: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 };
      // Panes the target is not in stay uncovered where there is room.
      const panes = [...document.querySelectorAll(".pane")].filter((n) => !n.contains(el) && !n.closest("[role=dialog]")).map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      const sb = document.querySelector('aside.sidebar[aria-label="Sidebar"]')?.getBoundingClientRect();
      const sidebar = sb && sb.width > 0 && sb.height > 0 ? { left: sb.left, top: sb.top, width: sb.width, height: sb.height } : null;
      const p = place(t, { width: Math.min(320, window.innerWidth - 32), height: box.current?.offsetHeight ?? 140 }, b, step.side, panes, sidebar);
      const k = [t.left, t.top, t.width, t.height, p.left, p.top, p.side].map(String).join();
      if (k !== key) {
        key = k;
        setGeo({ t: { left: t.left, top: t.top, width: t.width, height: t.height }, p });
      }
    };
    tick();
    const wake = () => !document.hidden && tick();
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [tour, at]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape is Skip, before any page shortcut sees it.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onEnd("skipped");
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onEnd]);

  // A step without Next moves on when its real control is clicked.
  useEffect(() => {
    if (!step.noNext) return;
    const click = (e: MouseEvent) => {
      const el = stepEl(step);
      if (el && e.target instanceof Node && el.contains(e.target)) (next === null ? onEnd("done") : onAt(next));
    };
    window.addEventListener("click", click, true);
    return () => window.removeEventListener("click", click, true);
  }, [step, next, onAt, onEnd]);

  const w = stepWords(step);
  const act = actionWord(step);
  const pr = progress(tour, present, at);
  const label = pr.label;
  const arrow = geo?.p.side ? (geo.p.side === "bottom" || geo.p.side === "top" ? { left: Math.max(14, Math.min(geo.t.left + geo.t.width / 2 - geo.p.left, (box.current?.offsetWidth ?? 320) - 14)) } : { top: Math.max(14, Math.min(geo.t.top + geo.t.height / 2 - geo.p.top, (box.current?.offsetHeight ?? 140) - 14)) }) : null;
  return (
    <>
      {tour.ring && geo && <div className="tour-ring" style={{ left: geo.t.left - 4, top: geo.t.top - 4, width: geo.t.width + 8, height: geo.t.height + 8 }} aria-hidden="true" />}
      <div ref={box} className="tour" role="dialog" aria-modal="false" aria-label={`${tour.name} tour`} data-tour={tour.id} style={geo ? { left: geo.p.left, top: geo.p.top, ...(geo.p.width ? { width: geo.p.width } : {}) } : { visibility: "hidden", left: 0, top: 0 }}>
        {arrow && <span className={`tour-arrow ${geo!.p.side}`} style={arrow} aria-hidden="true" />}
        <h3>{w.title}</h3>
        <p>{w.body}</p>
        <div className="tour-foot">
          {pr.dots > 1 && (
            <span className="tour-dots" aria-hidden="true">
              {Array.from({ length: pr.dots }, (_, i) => (
                <i key={i} className={i === pr.on ? "on" : ""} />
              ))}
            </span>
          )}
          {label && <span className="tour-label">{label}</span>}
          <span className="spacer" />
          <button className="btn" onClick={() => onEnd("skipped")}>
            Skip
          </button>
          {back !== null && (
            <button className="btn" onClick={() => onAt(back)}>
              Back
            </button>
          )}
          {act ? (
            <button
              className="btn primary"
              onClick={() => {
                const el = shown(step.action?.click ?? FOCUSED_SPLIT);
                if (el && el.getAttribute("aria-pressed") !== "true") el.click();
              }}
            >
              {act}
            </button>
          ) : (
            !step.noNext && (
              <button className="btn primary" onClick={() => (next === null ? onEnd("done") : onAt(next))} autoFocus>
                {next === null ? "Done" : "Next"}
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}

/** 49-ux2: what to tell the user when a tour they asked for (Help > a tour) is dropped or gives up, so a
 *  replay is never silent. `off` is the owning feature being switched off. A page change or another tour
 *  starting is the user's own doing and says nothing; an automatic tour never speaks. Kept here, not in
 *  tour.ts, so the code loaded at start does not carry it. */
export function tourNotice(name: string, w: Want, act: ReturnType<typeof lookAt>, gave: boolean, off: boolean): string | null {
  if (!w.forced) return null;
  if (act === "drop" && off) return `The ${name} tour is off because its feature is switched off in Settings.`;
  if (act === "miss" && gave) return `The ${name} tour needs its screen showing. Open that screen, then replay the tour from Help.`;
  return null;
}

export default function Tours() {
  const rec = useRef<GuideRecord | null>(null);
  const slot = useRef(false);
  const want = useRef<Want | null>(null);
  const settings = useRef<Record<string, unknown> | null>(null);
  const [run, setRun] = useState<{ tour: Tour; at: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // 49-ux2: why a replay did not start
  const running = useRef<TourId | null>(null);
  running.current = run?.tour.id ?? null;
  const here = useRef(0); // the step the running tour is on, for the hand-over
  here.current = run?.at ?? 0;

  useEffect(() => {
    invoke<GuideRecord>("tours_get").then(
      (r) => {
        rec.current = r;
        features.loaded(r.features); // ONB-042: uses count from here on
      },
      () => {},
    );
    invoke<Record<string, unknown>>("get_settings").then((x) => (settings.current = x), () => {});
    const surfaced = new Set<TourId>();
    // ONB-012: nothing replays the grid tour.
    const replay = (e: Event) => {
      const r = replayOf((e as CustomEvent).detail);
      if (r && r.id !== "grid") want.current = { id: r.id, forced: true, tries: 0, page: pageKey(), after: r.after };
    };
    // Any split counts (ONB-033: the parallel tour is for people who never split), and a split
    // during the parallel tour carries it past its split step.
    const split = () => {
      noteUse("split");
      if (rec.current && !rec.current.tried.includes("split")) {
        rec.current.tried = [...rec.current.tried, "split"];
        markGuide("tried", "split").catch(() => {});
      }
      setRun((r) => (r && r.tour.id === "parallel" && r.at === 0 ? { ...r, at: 1 } : r));
    };
    const click = (e: MouseEvent) => e.target instanceof Element && e.target.closest(".pane-head button[title^='Split right']") && split();
    const key = (e: KeyboardEvent) => SPLIT_KEY(e) && split();
    // ONB-012: the first run ended with a kit or a plain session: the grid tour once, if unseen.
    const grid = () => {
      if (!gridStarts("session", rec.current?.toursSeen ?? [])) return;
      slot.current = true;
      want.current = { id: "grid", forced: false, tries: 0, limit: GRID_TRIES, page: pageKey() };
    };
    window.addEventListener(START_GRID, grid);
    window.addEventListener(REPLAY_TOUR, replay);
    window.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    // ponytail: a quarter-second look for surfaces; an observer per tour if this ever shows in a profile.
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const r = rec.current;
      const w = want.current;
      if (w) {
        const tour = TOURS.find((t) => t.id === w.id);
        const first = tour && nextShown(tour.steps.map((st) => !!stepEl(st)), -1);
        const off = ownerOff(settings.current, w.id);
        const act = lookAt(w, { running: running.current, page: pageKey(), firstShown: first !== null && first !== undefined, blocked: blocked(), off, detached: !!tour?.detached });
        const gave = act === "miss" && (++w.tries, gaveUp(w));
        if (act === "start" && tour && first !== null && first !== undefined) {
          want.current = null;
          setRun({ tour, at: first });
        } else if (act === "drop" || gave) {
          // Gave up or was called off without showing: an automatic tour hands its slot back and is not marked seen.
          want.current = null;
          const why = tourNotice(tour?.name ?? w.id, w, act, gave, off && !tour?.detached);
          if (why) setNotice(why);
          if (!w.forced) slot.current = false;
        }
        return;
      }
      if (running.current) return;
      if (!r) return;
      // ONB-042: opening a surface that has a tour counts as using that feature, once per window.
      for (const t of TOURS) if (!surfaced.has(t.id) && tourFeature(t.id) && shown(t.trigger) && noteUse(t.id)) surfaced.add(t.id);
      const workspaceTab = !!document.querySelector(".sess.sel");
      const auto = TOURS.find((t) => autoStarts({ id: t.id, auto: r.toursAuto, seen: r.toursSeen, slotUsed: slot.current, blocked: blocked(), tried: hasUsed("split") ? [...r.tried, "split"] : r.tried, workspaceTab }) && shown(t.trigger) && !ownerOff(settings.current, t.id));
      if (auto) {
        slot.current = true;
        want.current = { id: auto.id, forced: false, tries: 0, page: pageKey() };
      }
    }, 250);
    return () => {
      window.removeEventListener(START_GRID, grid);
      window.removeEventListener(REPLAY_TOUR, replay);
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [notice]);
  if (!run)
    return notice ? (
      <div className="tour-notice" role="status" onClick={() => setNotice(null)}>
        {notice}
      </div>
    ) : null;
  const end = (how: "done" | "skipped" | "lost") => {
    const id = run.tour.id;
    const next = handsOver(id, how, here.current);
    setRun(null);
    // ONB-033: the create button opened the composer: the workspace-creation tour takes over, once the composer shows.
    if (next) want.current = { id: next, forced: true, tries: 0, page: pageKey() };
    if (how === "lost") return;
    // Skipping or finishing marks it seen, once.
    if (rec.current && !rec.current.toursSeen.includes(id)) {
      rec.current.toursSeen = [...rec.current.toursSeen, id];
      markGuide("toursSeen", id).catch(() => {});
    }
  };
  return <TourPanel key={run.tour.id} tour={run.tour} at={run.at} onAt={(at) => setRun({ ...run, at })} onEnd={end} />;
}
