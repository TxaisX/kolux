// ONB-031 contextual tour overlay, ONB-032 when tours start by themselves and ONB-033 the
// catalogue: the pure rules behind Tours.tsx. Targets are CSS selectors into the live window.
import { locale } from "../language";

type Words = { title: string; body: string };
export type Side = "top" | "bottom" | "left" | "right";
export type TourStep = {
  target: string;
  /** ONB-033: other places to point at when `target` is not on screen, in order (the cookie row in the
   *  overflow menu behind its hint button). */
  alt?: string[];
  /** ONB-033: a control to click once when the target is hidden (the sidebar's toggle, when the sidebar is hidden). */
  reveal?: string;
  side: Side;
  en: Words;
  ko: Words;
  /** Swaps Next for a button that does the step's job (the parallel tour's Split terminal). */
  action?: { en: string; ko: string; run: "split" | "click"; click?: string };
  /** The real control is what to click, so there is no Next. */
  noNext?: boolean;
};
export type TourId = "tasks" | "automations" | "parallel" | "grid" | "board";
export type Tour = {
  id: TourId;
  name: string;
  trigger: string;
  steps: TourStep[];
  ring?: boolean;
  /** ONB-033: the progress always counts this many steps, even while one of them has no target on screen. */
  count?: number;
  /** ONB-032: runs even with its owning feature switched off (the tour is deliberately detached from it). */
  detached?: boolean;
};

/** Every step target in the order it is tried. */
export const targetsOf = (s: TourStep): string[] => [s.target, ...(s.alt ?? [])];

/** The split button of the focused terminal pane. */
/** ONB-012: the grid tour's three targets: the running session, its status dot in the sidebar and
 *  the results entry (the sidebar marks it data-results, VIEW-114 hunk; a missing target is skipped). */
export const GRID_PANE = ".pane.focused";
export const GRID_STATUS = ".sb-list .dot.live";
export const GRID_RESULTS = "[data-results]";
export const FOCUSED_SPLIT = ".pane.focused .pane-head button[title^='Split right']";

/** ONB-033: the board. */
export const BOARD_LANE = ".board .lane";
export const BOARD_CARD = ".board .pane";
export const SIDEBAR_SHOW = "button[title='Show sidebar']";

/** ONB-033, the surfaces Kolux has today (the grid tour starts from the first run's end, T-208-b). */
export const TOURS: Tour[] = [
  {
    id: "tasks",
    name: "Tasks",
    trigger: "[data-tasks] .tasks-list li",
    steps: [
      { target: "[data-tasks] .tasks-list li", side: "bottom", en: { title: "Start from a row", body: "Click an issue or pull request to read it and start an agent on it." }, ko: { title: "행에서 시작", body: "이슈나 풀 리퀘스트를 클릭해 읽고 에이전트에게 맡기세요." } },
      { target: "[data-tasks] select[aria-label=Preset]", side: "bottom", en: { title: "Pick the source", body: "Choose which list of issues and pull requests to show." }, ko: { title: "출처 고르기", body: "보여 줄 이슈와 풀 리퀘스트 목록을 고릅니다." } },
      { target: "[data-tasks] .autos-search", side: "bottom", en: { title: "Filter", body: "Narrow the list with a GitHub search, such as is:pr label:bug." }, ko: { title: "필터", body: "is:pr label:bug 같은 GitHub 검색으로 목록을 좁힙니다." } },
    ],
  },
  {
    id: "automations",
    name: "Automations",
    trigger: ".autos:not(.tasks) .autos-bar .btn.primary",
    steps: [
      { target: ".autos:not(.tasks) .autos-bar .btn.primary", side: "bottom", en: { title: "Create an automation", body: "Give an agent a job that runs on a schedule, by itself." }, ko: { title: "자동화 만들기", body: "에이전트에게 일정에 따라 스스로 실행되는 일을 맡깁니다." } },
      { target: ".autos:not(.tasks) .autos-bar button[title^='Every automation']", side: "bottom", en: { title: "See the results", body: "Every run of every automation, with what it did, in one place." }, ko: { title: "결과 보기", body: "모든 자동화의 실행과 결과를 한곳에서 봅니다." } },
    ],
  },
  {
    id: "parallel",
    name: "Agents in parallel",
    trigger: FOCUSED_SPLIT,
    ring: true,
    steps: [
      { target: FOCUSED_SPLIT, side: "bottom", action: { en: "Split terminal", ko: "터미널 나누기", run: "split" }, en: { title: "Run agents side by side", body: "Split the pane to get a second terminal in the same folder." }, ko: { title: "에이전트를 나란히", body: "창을 나눠 같은 폴더에서 두 번째 터미널을 엽니다." } },
      { target: GRID_STATUS, reveal: SIDEBAR_SHOW, side: "right", en: { title: "Tell them apart", body: "Both agents work in this project's folder. Each has its own dot in the sidebar: it turns yellow when it needs you and green when it is done. Give each a different task so they do not edit the same files." }, ko: { title: "구분하기", body: "두 에이전트 모두 이 프로젝트 폴더에서 일합니다. 각자 사이드바에 점이 있어 도움이 필요하면 노란색, 끝나면 초록색이 됩니다. 같은 파일을 고치지 않도록 서로 다른 작업을 맡기세요." } },
    ],
  },
  {
    // ONB-012: started only by a first run that ends with a kit or a plain session, once; nothing replays it.
    id: "grid",
    name: "Your first session",
    trigger: GRID_PANE,
    steps: [
      { target: GRID_PANE, side: "bottom", en: { title: "This is a session", body: "An AI agent works here in its own terminal. Type to it any time." }, ko: { title: "세션입니다", body: "AI 에이전트가 자기 터미널에서 일합니다. 언제든 입력할 수 있습니다." } },
      { target: GRID_STATUS, side: "right", en: { title: "Its status", body: "The dot spins while it works, turns yellow when it needs you and green when it is done." }, ko: { title: "상태", body: "일하는 동안 점이 돌고, 도움이 필요하면 노란색, 끝나면 초록색이 됩니다." } },
      { target: GRID_RESULTS, side: "right", en: { title: "Your results", body: "What a kit makes is gathered here, ready to open." }, ko: { title: "결과", body: "키트가 만든 것이 여기에 모여 바로 열 수 있습니다." } },
    ],
  },
  {
    id: "board",
    name: "Board",
    trigger: BOARD_LANE,
    steps: [
      { target: BOARD_LANE, side: "bottom", en: { title: "Watch work move", body: "Each column is a state: Needs you, Working, Done, Stopped or Idle. A card moves as its agent's state changes." }, ko: { title: "작업 지켜보기", body: "각 열은 에이전트의 상태입니다. 상태가 바뀌면 카드가 열 사이를 옮겨 갑니다." } },
      { target: BOARD_CARD, alt: [".board"], side: "right", en: { title: "Move cards through the lanes", body: "A card follows its agent from lane to lane until it is done." }, ko: { title: "카드를 단계별로 옮기기", body: "카드는 에이전트를 따라 끝날 때까지 열 사이를 이동합니다." } },
    ],
  },
];

export const stepWords = (s: TourStep): Words => (locale() === "ko" ? s.ko : s.en);
export const actionWord = (s: TourStep) => (s.action ? (locale() === "ko" ? s.action.ko : s.action.en) : null);

/** A step label only when more than one step shows: "2 of 3". */
export const stepLabel = (i: number, n: number) => (n > 1 ? `${i + 1} of ${n}` : null);

/** The next step after `i` (or the first, from -1) whose target is present; null when none is. */
export function nextShown(present: readonly boolean[], i: number): number | null {
  for (let j = i + 1; j < present.length; j++) if (present[j]) return j;
  return null;
}
export function prevShown(present: readonly boolean[], i: number): number | null {
  for (let j = i - 1; j >= 0; j--) if (present[j]) return j;
  return null;
}

/** Whether a tour may start by itself this launch (replay buttons skip every one of these). */
export function autoStarts(o: { id: TourId; auto: boolean | null; seen: readonly string[]; slotUsed: boolean; blocked: boolean; tried: readonly string[]; workspaceTab?: boolean }): boolean {
  // ONB-012: the grid tour never starts by itself; only the first run's end starts it.
  if (o.id === "grid") return false;
  if (!o.auto || o.slotUsed || o.blocked || o.seen.includes(o.id)) return false;
  // ONB-033: the parallel tour only for someone who has never split a pane.
  if (o.id === "parallel" && o.tried.includes("split")) return false;
  // ONB-033: ...and only on the terminal tab of a workspace (an unset answer means the caller does not know: not blocked).
  return !(o.id === "parallel" && o.workspaceTab === false);
}

/** Waiting for a first target gives up after this many looks, a quarter second apart. */
export const FIRST_TARGET_TRIES = 20;

export type Rect = { left: number; top: number; width: number; height: number };
export type Placed = { left: number; top: number; side: Side | null; width?: number };
const GAP = 10;
/** The narrowest a callout is squeezed to so as to stay off a pane. */
const MIN_WIDTH = 240;
const meets = (l: number, t: number, w: number, h: number, o: Rect) => l < o.left + o.width && l + w > o.left && t < o.top + o.height && t + h > o.top;

/** The panel inside the left sidebar column, level with the target; the arrow side faces the target.
 *  Null when the column is narrower than MIN_WIDTH, the target is in it with no room above or below, or a pane is still hit. */
function inSidebar(t: Rect, p: { width: number; height: number }, b: Rect, avoid: readonly Rect[], sb: Rect | null): Placed | null {
  if (!sb || sb.width < MIN_WIDTH) return null;
  const lo = Math.max(b.left, sb.left);
  const hi = Math.min(b.left + b.width, sb.left + sb.width);
  const w = Math.min(p.width, hi - lo);
  if (w < MIN_WIDTH) return null;
  const vlo = Math.max(b.top, sb.top);
  const vbot = Math.min(b.top + b.height, sb.top + sb.height);
  const vhi = vbot - p.height;
  const clampY = (v: number) => Math.max(vlo, Math.min(v, Math.max(vlo, vhi)));
  let got: Placed;
  if (t.left >= hi) got = { side: "left", left: lo, top: clampY(t.top + t.height / 2 - p.height / 2) };
  else if (t.left + t.width <= lo) got = { side: "right", left: lo, top: clampY(t.top + t.height / 2 - p.height / 2) };
  else if (t.top + t.height + GAP <= vhi) got = { side: "bottom", left: lo, top: t.top + t.height + GAP };
  else if (t.top - GAP - p.height >= vlo) got = { side: "top", left: lo, top: t.top - GAP - p.height };
  else return null;
  if (avoid.some((o) => meets(got.left, got.top, w, p.height, o))) return null;
  return w < p.width ? { ...got, width: w } : got;
}

/** ONB-031: the panel on the step's side of the target when it fits, else the opposite side, else
 *  any side that fits; with no room anywhere it stays inside `b`, covering the target. A null
 *  side means no arrow. `avoid` (panes the target is not in) is a preference: the first side whose
 *  panel, narrowed if need be, stays clear of every one wins; if none does, the panel goes inside `sidebar`
 *  (the left column, when it is wide enough) with the arrow still on the target, else the plain choice stands. */
export function place(t: Rect, p: { width: number; height: number }, b: Rect, want: Side, avoid: readonly Rect[] = [], sidebar: Rect | null = null): Placed {
  const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const order: Side[] = [want, opposite[want], ...(["bottom", "top", "right", "left"] as Side[]).filter((s) => s !== want && s !== opposite[want])];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const cx = t.left + t.width / 2 - p.width / 2;
  const cy = t.top + t.height / 2 - p.height / 2;
  let plain: Placed | null = null;
  for (const s of order) {
    const at =
      s === "bottom"
        ? { left: cx, top: t.top + t.height + GAP }
        : s === "top"
          ? { left: cx, top: t.top - GAP - p.height }
          : s === "right"
            ? { left: t.left + t.width + GAP, top: cy }
            : { left: t.left - GAP - p.width, top: cy };
    const fits = s === "bottom" || s === "top" ? at.top >= b.top && at.top + p.height <= b.top + b.height : at.left >= b.left && at.left + p.width <= b.left + b.width;
    if (!fits) continue;
    const got: Placed = { side: s, left: clamp(at.left, b.left, b.left + b.width - p.width), top: clamp(at.top, b.top, b.top + b.height - p.height) };
    const hit = avoid.filter((o) => meets(got.left, got.top, p.width, p.height, o));
    if (!hit.length) return got;
    plain ??= got;
    // Above or below the target the callout can shrink to the free band beside the panes.
    if (s === "top" || s === "bottom") {
      const lo = Math.max(b.left, ...hit.map((o) => o.left + o.width));
      const w = Math.min(p.width, b.left + b.width - lo);
      const left = clamp(at.left, lo, b.left + b.width - w);
      if (w >= MIN_WIDTH && !avoid.some((o) => meets(left, got.top, w, p.height, o))) return { ...got, left, ...(w < p.width ? { width: w } : {}) };
    }
  }
  if (plain) return inSidebar(t, p, b, avoid, sidebar) ?? plain;
  return { side: null, left: clamp(cx, b.left, b.left + b.width - p.width), top: clamp(cy, b.top, b.top + b.height - p.height) };
}

// ---- asking for a tour from anywhere (the help menu's replay items) ----
export const REPLAY_TOUR = "kolux-replay-tour";
/** `after`: hold off until that tour has finished (ONB-032). */
export const replayTour = (id: TourId, after?: TourId) => window.dispatchEvent(new CustomEvent(REPLAY_TOUR, { detail: after ? { id, after } : { id } }));
/** The tour a replay event asks for; older callers sent just the id. */
export function replayOf(detail: unknown): { id: TourId; after?: TourId } | null {
  if (typeof detail === "string") return { id: detail as TourId };
  const d = detail as { id?: unknown; after?: unknown } | null;
  return d && typeof d.id === "string" ? { id: d.id as TourId, after: typeof d.after === "string" ? (d.after as TourId) : undefined } : null;
}

/** ONB-012: the first run ended with a kit or a plain session; the grid tour runs once, if unseen. */
export const START_GRID = "kolux-start-grid-tour";
export const startGridTour = () => window.dispatchEvent(new CustomEvent(START_GRID));
/** ONB-012: whether the first run's end starts the grid tour: only a finish by kit or session, only once. */
export const gridStarts = (how: "kit" | "session" | "skip" | "folder", seen: readonly string[]) => (how === "kit" || how === "session") && !seen.includes("grid");
/** ONB-042: the tours whose surface is a feature the profile keeps a use of. The grid tour is a
 *  tour of the whole first screen, not a feature on the fixed list, so opening it notes nothing. */
export const tourFeature = (id: TourId): boolean => id !== "grid";
/** A kit start can take a while to open its panes: the grid tour waits this many looks for its first target. */
export const GRID_TRIES = 4 * FIRST_TARGET_TRIES;

// ---- ONB-032: a tour that is waiting to start ----

/** A tour waiting for its first target. `page` is where the user was when it was asked for; `after` is a
 *  tour it holds off for until that one has finished. */
export type Want = { id: TourId; forced: boolean; tries: number; limit?: number; page: string; after?: TourId };
export type Look = { running: TourId | null; page: string; firstShown: boolean; blocked: boolean; off: boolean; detached: boolean };

/** What a waiting tour does on this look:
 *  - drop: a forced request when the user has moved to another page or another tour (not the one it waits for) has
 *    started; a tour whose owning feature is switched off, unless it is detached from it;
 *  - wait: a tour is showing (an automatic one just waits; a forced one waits only for the tour it holds off for);
 *  - start: the first target is on screen (an automatic one also needs no confirmation dialog);
 *  - miss: nothing to do yet; the caller counts this against the cap. */
export function lookAt(w: Want, l: Look): "start" | "wait" | "drop" | "miss" {
  if (l.off && !l.detached) return "drop";
  if (w.forced && l.page !== w.page) return "drop";
  if (l.running !== null) return !w.forced || w.after === l.running ? "wait" : "drop";
  if (l.firstShown && (w.forced || !l.blocked)) return "start";
  return "miss";
}

/** Whether a waiting tour has used up its looks. */
export const gaveUp = (w: Want) => w.tries >= (w.limit ?? (w.forced ? 4 * FIRST_TARGET_TRIES : FIRST_TARGET_TRIES));

/** ONB-032: the settings key that switches off the feature a tour belongs to; `false` there holds the tour back. */
export const OWNER_SWITCH: Partial<Record<TourId, string>> = { board: "boardView", tasks: "tasksPage", automations: "automationsPage" };
export const ownerOff = (settings: Record<string, unknown> | null, id: TourId): boolean => {
  const key = OWNER_SWITCH[id];
  return !!key && settings !== null && settings[key] === false;
};

// ---- ONB-033: progress, the hand-over and naming ----

/** The step label and dots. A tour with a fixed `count` always counts that many steps, by position, even while one
 *  has no target on screen; others count only the steps that show. */
export function progress(tour: Pick<Tour, "count">, present: readonly boolean[], at: number): { label: string | null; dots: number; on: number } {
  const shownIdx = present.flatMap((p, i) => (p ? [i] : []));
  if (tour.count) return { label: stepLabel(at, tour.count), dots: tour.count, on: at };
  return { label: stepLabel(shownIdx.indexOf(at), shownIdx.length), dots: shownIdx.length, on: shownIdx.indexOf(at) };
}

/** ONB-033: automatic naming from the first message. Turning it on clears a generated name (a name the user typed stays);
 *  turning it off keeps whatever name there is. */
export function nameAfterToggle(autoName: boolean, name: string, generated: boolean): string {
  return autoName && generated ? "" : name;
}
