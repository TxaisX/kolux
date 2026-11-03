// ONB-014 Setup Guide, ONB-017 its CLI step, ONB-022 Explore Kolux and ONB-027 startup tips: the
// model behind the dialogs in Guides.tsx. The window opens them through the events below, so the
// help menu, a tip or any other caller can ask for a guide without passing state around.
// ONB-015: every step ticks from real state (doneFrom); ONB-023: an Explore stop is complete only
// after a visit plus its setup (stopDone). The legacy-profile rule and the step actions are T-321-b.
import { invoke } from "@tauri-apps/api/core";
import { locale } from "../language";
import type { FirstRun } from "./newcomer";
import { noteUse, type Features } from "./features";
import { movedHint, type MovedId } from "./moved";
import { isAiAgent } from "./agentKind";

export type StepId = "browser" | "notifications" | "agent" | "cli" | "integrations" | "multitask" | "automate" | "repos";
type Words = { name: string; about: string };
export type Step = { id: StepId; group: "setup" | "parallel"; core: boolean; en: Words; ko: Words };

/** The eight steps: the Setup group first, then the numbered parallel-work group. Connect
 *  integrations and the browser are optional, so they never keep Milestones in the help menu. */
export const STEPS: Step[] = [
  { id: "notifications", group: "setup", core: true, en: { name: "Turn on notifications", about: "Hear when an agent finishes or needs you, even with Kolux in the background." }, ko: { name: "알림 켜기", about: "Kolux가 백그라운드에 있어도 에이전트가 끝나거나 도움이 필요할 때 알려 줍니다." } },
  { id: "agent", group: "setup", core: true, en: { name: "Choose a default agent", about: "Pick the AI that starts when you open a new session." }, ko: { name: "기본 에이전트 선택", about: "새 세션을 열 때 시작할 AI를 고릅니다." } },
  { id: "cli", group: "setup", core: true, en: { name: "Enable Kolux CLI", about: "Let your agents drive Kolux: open terminals, run orchestration and read the skills that teach them how." }, ko: { name: "Kolux CLI 사용", about: "에이전트가 Kolux를 직접 다루게 합니다: 터미널 열기, 오케스트레이션 실행, 사용법을 알려 주는 스킬 읽기." } },
  { id: "browser", group: "setup", core: false, en: { name: "Use Kolux's browser", about: "Open web pages beside your terminals so an agent's work and its preview sit together." }, ko: { name: "Kolux 브라우저 사용", about: "터미널 옆에서 웹 페이지를 열어 에이전트의 작업과 미리보기를 함께 봅니다." } },
  { id: "integrations", group: "setup", core: false, en: { name: "Connect integrations", about: "Bring in GitHub reviews and tasks so work arrives where you run it." }, ko: { name: "통합 연결", about: "GitHub 리뷰와 작업을 가져와 일하는 곳에서 바로 받습니다." } },
  { id: "multitask", group: "parallel", core: true, en: { name: "Multi-task", about: "Run more than one agent at once, each in its own pane." }, ko: { name: "멀티태스킹", about: "여러 에이전트를 각자의 창에서 동시에 실행합니다." } },
  { id: "automate", group: "parallel", core: true, en: { name: "Automate workspace setup", about: "Have each new workspace install and prepare itself before an agent starts." }, ko: { name: "작업 공간 설정 자동화", about: "새 작업 공간마다 에이전트가 시작하기 전에 스스로 설치하고 준비하게 합니다." } },
  { id: "repos", group: "parallel", core: true, en: { name: "Start work in multiple repos", about: "Add a second project and keep agents busy in both." }, ko: { name: "여러 저장소에서 작업 시작", about: "두 번째 프로젝트를 추가하고 두 곳 모두에서 에이전트를 일하게 합니다." } },
];

/** A step's name and description in the interface language (English unless it is Korean). */
export const words = (s: Step): Words => (locale() === "ko" ? s.ko : s.en);

/** The step the guide opens on: the one asked for, else the first unfinished one (Setup first,
 *  then parallel work, which is the list's own order), else the first step. */
export function firstOpen(done: ReadonlySet<StepId>, ask?: StepId | null): StepId {
  if (ask && STEPS.some((s) => s.id === ask)) return ask;
  return (STEPS.find((s) => !done.has(s.id)) ?? STEPS[0]).id;
}

/** Once the step showing is done, the guide moves to the next unfinished one after it (or the
 *  first unfinished from the top); with everything done it stays. */
export function moveOn(at: StepId, done: ReadonlySet<StepId>): StepId {
  if (!done.has(at)) return at;
  const i = STEPS.findIndex((s) => s.id === at);
  const next = [...STEPS.slice(i + 1), ...STEPS.slice(0, i)].find((s) => !done.has(s.id));
  return next ? next.id : at;
}

/** The ring: core steps done out of all core steps. */
export function ring(done: ReadonlySet<StepId>): { done: number; total: number } {
  const core = STEPS.filter((s) => s.core);
  return { done: core.filter((s) => done.has(s.id)).length, total: core.length };
}

/** Milestones stays in the help menu only while a core step remains. */
export const milestonesShown = (done: ReadonlySet<StepId>) => ring(done).done < ring(done).total;

// ---- ONB-017: the CLI step's capabilities ----

export type CliStatus = { installed: boolean; onPath: boolean };
export type CapId = "command" | "kolux-cli" | "orchestration";
export type Cap = { id: CapId; label: string; about: string; ready: boolean };

/** What the CLI step sets up and whether each is in place: the command in outside terminals, and
 *  the two Kolux skills found in an agent's own skills folder (bundled copies do not count). */
export function caps(cli: CliStatus | null, homeSkills: readonly string[]): Cap[] {
  return [
    { id: "command", label: "Kolux CLI", about: "The kolux command in terminals outside Kolux, so any agent can call it.", ready: !!cli?.installed && !!cli.onPath },
    { id: "kolux-cli", label: "Kolux CLI skill", about: "Teaches your agents every kolux command.", ready: homeSkills.includes("kolux-cli") },
    { id: "orchestration", label: "Orchestration skill", about: "Lets one agent hand work to others and wait for their results.", ready: homeSkills.includes("orchestration") },
  ];
}

/** Missing capabilities start ticked, ready ones unticked. */
export const startTicked = (c: readonly Cap[]): CapId[] => c.filter((x) => !x.ready).map((x) => x.id);

// ---- ONB-022: Explore Kolux ----

export type Stop = { id: string; title: string; caption: string; optional?: boolean };
export type Workflow = Stop & { stops: Stop[] };

export const WORKFLOWS: Workflow[] = [
  { id: "workspaces", title: "Workspaces", caption: "Each workspace is its own copy of a project, so agents can work side by side without stepping on each other.", stops: [] },
  { id: "tasks", title: "Tasks", caption: "Tasks gather what needs doing: from GitHub, from your notes or typed in. Start an agent on any of them with one click, and its progress shows on the task.", stops: [] },
  {
    id: "agents",
    title: "Agents",
    caption: "Run Claude Code, Codex and Grok in panes beside each other and see at a glance which one needs you.",
    stops: [
      { id: "statuses", title: "Statuses", caption: "Every pane says whether its agent is working, done or waiting for you, and the sidebar sums it up." },
      { id: "usage", title: "Usage", caption: "See how much of each plan's limit is left and what your sessions cost.", optional: true },
      { id: "orchestration", title: "Orchestration", caption: "One agent splits a job, hands the parts to others and gathers their results.", optional: true },
    ],
  },
  {
    id: "workbench",
    title: "Workbench",
    caption: "Everything an agent's work needs sits in one window.",
    stops: [
      { id: "terminal", title: "Terminal", caption: "Terminals in a grid of one, two, four or six panes." },
      { id: "editor", title: "Editor", caption: "Open and edit the files an agent touched without leaving Kolux." },
      { id: "browser", title: "Browser", caption: "Preview what was built in a browser tab beside the terminal.", optional: true },
    ],
  },
  {
    id: "review",
    title: "Review",
    caption: "Check the work before it ships.",
    stops: [
      { id: "notes", title: "Notes", caption: "Leave notes on lines of a change for the agent to act on." },
      { id: "pr", title: "PR view", caption: "Read a pull request's changes and checks in one place.", optional: true },
      { id: "ship", title: "Ship", caption: "Commit, push and open the pull request when it is ready.", optional: true },
    ],
  },
];

/** Where the tour is: a workflow, and one of its stops (-1 is the workflow's own page). */
export type At = { w: number; s: number };
export const stopOf = (at: At): Stop => (at.s < 0 ? WORKFLOWS[at.w] : WORKFLOWS[at.w].stops[at.s]);

/** Continue: a workflow's stops come before the next workflow; null past the last one. */
export function forward(at: At): At | null {
  if (at.s + 1 < WORKFLOWS[at.w].stops.length) return { w: at.w, s: at.s + 1 };
  return at.w + 1 < WORKFLOWS.length ? { w: at.w + 1, s: -1 } : null;
}

/** The rail's keys: up and down move one workflow, Home and End jump, and it stops at both ends. */
export function railKey(key: string, w: number): number | null {
  const last = WORKFLOWS.length - 1;
  if (key === "ArrowUp") return Math.max(0, w - 1);
  if (key === "ArrowDown") return Math.min(last, w + 1);
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
}

/** A workflow is Completed once it and each of its stops that is not optional were visited (or,
 *  for usage, the feature was tried: USAGE 012). */
export function completed(wf: Workflow, seen: ReadonlySet<string>): boolean {
  return seen.has(wf.id) && wf.stops.every((s) => s.optional || seen.has(s.id));
}

// ---- ONB-027: startup tips ----

export type TipId = "cli" | "palette" | MovedId;
/** Newest first: the CLI tip, then the command-palette tip. */
export const TIP_ORDER: TipId[] = ["cli", "palette"];

/** The one tip this launch shows, or none. `cli` is "error" when its status could not be read, which
 *  counts as installed. No tip in a session that showed the first-run wizard. */
export function nextTip(o: { seen: readonly string[]; tried: readonly string[]; cli: CliStatus | "error"; onboarding: boolean; features?: Features }): TipId | null {
  if (o.onboarding) return null;
  // ONB-042: a moved control's hint comes first, and only for a profile that used the control before it moved.
  const moved = movedHint(o.features, o.seen);
  if (moved) return moved;
  const done = (t: TipId) => (t === "cli" ? o.cli === "error" || (o.cli.installed && o.cli.onPath) : o.tried.includes("palette"));
  return TIP_ORDER.find((t) => !o.seen.includes(t) && !o.tried.includes(t) && !done(t)) ?? null;
}

// ---- opening the guides from anywhere ----

export const OPEN_GUIDE = "kolux-open-guide";
export const OPEN_EXPLORE = "kolux-open-explore";
/** Opens the Setup Guide, on `step` when given. */
export const openGuide = (step?: StepId) => window.dispatchEvent(new CustomEvent(OPEN_GUIDE, { detail: step ?? null }));
export const openExplore = () => window.dispatchEvent(new CustomEvent(OPEN_EXPLORE));
/** VIEW-114 (FIX-2): sent when the Setup Guide closes, so the sidebar entry reads its steps again. */
export const GUIDE_CLOSED = "kolux-guide-closed";
export const guideClosed = () => window.dispatchEvent(new CustomEvent(GUIDE_CLOSED));

/** What the guides remember on this profile (onboarding.rs guide_get). */
/** guide_get also carries the first-run view for the newcomer checklist (ONB-013); guide_mark does not. */
export type GuideRecord = { tipsSeen: string[]; visited: string[]; tried: string[]; toursSeen: string[]; toursAuto: boolean | null; firstRun?: FirstRun | null; features?: Features };
/** Adds the id once to one of the record's lists; the stored record comes back. */
export const markGuide = (list: "tipsSeen" | "visited" | "tried" | "toursSeen", id: string) => invoke<GuideRecord>("guide_mark", { list, id });

// ---- ONB-015: the steps tick from real state, not from clicks ----

/** A workspace as workspace_list gives it; only what the Multi-task rule reads. */
export type Place = { path: string; head: string; isMain: boolean; kind?: string | null };

/** What the guide read from this computer. A null fact is one not read yet or whose read failed:
 *  it never ticks a step (a failed status read is never taken as completion). */
export type Facts = {
  /** Each git project's workspaces. */
  workspaces: Place[][] | null;
  /** The git projects seen together at the most, kept on the profile (the lasting count). */
  gitProjects: number | null;
  /** A page other than a blank one was shown in Kolux's browser (kept on the profile). */
  pageShown: boolean;
  /** "checking" while the provider checks are still out. */
  integrations: "connected" | "checking" | "none" | null;
  /** The CLI step's capabilities, all in place. */
  cli: boolean;
  notifications: boolean | null;
  /** The saved default agent's id; "" when there is none. */
  agent: string | null;
  /** Some git project has a workspace setup script; a check that failed settles as false. */
  setupScript: boolean | null;
  /** ONB-015 legacy rule: an old profile (see legacyProfile); null when it could not be read. */
  legacy?: boolean | null;
  /** ONB-042: the legacy split-pane credit (moved.ts splitCredit); ticks Multi-task. */
  splitCredit?: boolean;
};

/** ONB-015 Multi-task: a real workspace besides the main folder. The main folder (or two entries
 *  for it) never counts, nor does a placeholder still being made (no commit yet). */
export const realWorkspace = (list: readonly Place[]): boolean => list.some((w) => !w.isMain && w.kind !== "main" && w.head.trim() !== "");

/** ONB-015: a blank page never counts as the browser having been used. */
export const pageCounts = (url: string | null | undefined): boolean => {
  const u = (url ?? "").trim().toLowerCase();
  return u !== "" && u !== "about:blank" && !u.startsWith("about:");
};

/** ONB-015: the steps done, each from the thing it stands for. */
export function doneFrom(f: Facts): Set<StepId> {
  if (f.legacy === true) return new Set(STEPS.map((s) => s.id)); // the legacy rule, everywhere
  const done = new Set<StepId>();
  if (f.workspaces?.some(realWorkspace) || f.splitCredit === true) done.add("multitask");
  if (f.pageShown) done.add("browser");
  if ((f.gitProjects ?? 0) >= 2) done.add("repos");
  if (f.integrations === "connected") done.add("integrations");
  if (f.cli) done.add("cli");
  if (f.notifications === true) done.add("notifications");
  if (isAiAgent(f.agent)) done.add("agent"); // FIX-4: a blank or plain-terminal default does not count (agentKind.ts)
  if (f.setupScript === true) done.add("automate");
  return done;
}

/** The tried-list id an older profile carries once it had finished the earlier steps. */
export const LEGACY_DONE = "setup-complete";

/** ONB-015 legacy rule: a profile that had finished the earlier steps, or had hidden the sidebar
 *  checklist (setupChecklist false), counts every step as complete. A failed read of both is null and
 *  never taken as completion; a retired step (the old split-terminal one) is not in STEPS, so it never counts. */
export function legacyProfile(settings: Record<string, unknown> | null, tried: readonly string[] | null): boolean | null {
  if (settings?.setupChecklist === false || tried?.includes(LEGACY_DONE)) return true;
  return settings === null && tried === null ? null : false;
}

/** 49-ux2: hiding the checklist from the sidebar has its own flag, so it is no longer read as "every step
 *  is done" (the legacy setupChecklist false still is, for profiles that saved it before this flag). */
export const HIDDEN_FIELD = "setupChecklistHidden";
export const checklistHidden = (settings: Record<string, unknown> | null | undefined): boolean => settings?.[HIDDEN_FIELD] === true;
/** The one settings patch a Hide click saves. */
export const HIDE_PATCH: Record<string, unknown> = { [HIDDEN_FIELD]: true };

/** The tried-list ids that keep facts on the profile: the browser page and the lasting repo count. */
export const PAGE_SHOWN = "browser-page";
export const TWO_REPOS = "repos-two";

/** ONB-015 setup-script step: answers to an older check are dropped. `begin` starts a check for new
 *  inputs (and resets readiness to unknown); `settle` takes its answer only if it is still the latest,
 *  and a check that failed settles as having no script. */
export function latest<T>(set: (v: T | null) => void) {
  let n = 0;
  return {
    begin: () => {
      n += 1;
      set(null);
      return n;
    },
    settle: (ticket: number, v: T) => void (ticket === n && set(v)),
  };
}

// ---- ONB-023: a stop is complete only after a visit and real setup ----

/** Stops whose setup is part of the stop, and the fact it needs. */
export type Setup = { taskSource: boolean; skills: readonly string[] };
const NEEDS: Record<string, (s: Setup) => boolean> = {
  tasks: (s) => s.taskSource,
  orchestration: (s) => s.skills.includes("orchestration"),
  browser: (s) => s.skills.includes("browser-use"),
};

/** Every id the tour knows: the workflows and their stops. */
export const TOUR_IDS: ReadonlySet<string> = new Set(WORKFLOWS.flatMap((w) => [w.id, ...w.stops.map((s) => s.id)]));

/** The visits kept on the profile, back on reopen; unknown or repeated entries dropped. */
export const visits = (ids: readonly string[]): string[] => [...new Set(ids.filter((i) => TOUR_IDS.has(i)))];

/** The tried-list id that keeps a stop complete for good. */
export const doneId = (id: string) => `explore-${id}`;

/** ONB-023: a stop (or workflow) is complete after a visit, plus its setup where the stop carries one;
 *  nothing is ticked just because it is already configured. Once complete (`kept`), it stays so even
 *  if detection later says unavailable. */
export const stopDone = (id: string, seen: ReadonlySet<string>, setup: Setup, kept: ReadonlySet<string>): boolean =>
  kept.has(doneId(id)) || (seen.has(id) && (NEEDS[id]?.(setup) ?? true));

/** ONB-023: a workflow is Completed once it and each stop that is not optional are complete. */
export const workflowDone = (wf: Workflow, seen: ReadonlySet<string>, setup: Setup, kept: ReadonlySet<string>): boolean =>
  stopDone(wf.id, seen, setup, kept) && wf.stops.every((s) => s.optional || stopDone(s.id, seen, setup, kept));

/** ONB-023: the visits and kept stops once the saved record arrives, merged into what this window
 *  already saw (a stop visited before the record loaded is never lost). */
export const withRecord = (seen: ReadonlySet<string>, kept: ReadonlySet<string>, g: { visited: readonly string[]; tried: readonly string[] }) => ({
  seen: new Set([...seen, ...visits(g.visited), ...g.tried]),
  kept: new Set([...kept, ...g.tried]),
});

/** ONB-015: the browser pane calls this when a page finishes loading; the first page other than a
 *  blank one marks the Browser step's fact on the profile and notes the use (ONB-042), once per
 *  window, so later page loads write nothing. A write that fails frees the note again, so the next
 *  page load tries once more (FIX-2); the use is still noted only once (FIX-4). */
export const pageNoter = (mark: typeof markGuide = markGuide, use: (id: string) => unknown = noteUse) => {
  let done = false;
  let used = false;
  return (url: string | null | undefined): void => {
    if (done || !pageCounts(url)) return;
    done = true;
    void mark("tried", PAGE_SHOWN).catch(() => {
      done = false;
    });
    // FIX-4: the use is noted once per window, so a retry of the write does not count the first page twice.
    if (!used) {
      used = true;
      use("browser-page");
    }
  };
};

/** The one page note the window shares (the browser pane calls `notePage(url)`). */
export const notePage = pageNoter();

// ---- ONB-029: the command palette tip's one-time demo ----

/** The palette's keys as the tip shows them: the user's binding, or the default when unassigned. */
export const paletteKeys = (user: readonly string[], fallback: readonly string[]): readonly string[] => (user.length ? user : fallback);

/** What the demo types into the palette before the create-workspace row comes up. */
export const DEMO_TEXT = "new-idea";
export type DemoFrame = { typed: string; create: boolean };
/** The demo's frames, one letter at a time, ending on the create-workspace row. With reduced motion
 *  only the end state, so no timer runs. It plays once: the last frame stays. */
export function demoFrames(reduced: boolean, text = DEMO_TEXT): DemoFrame[] {
  const end = { typed: text, create: true };
  if (reduced) return [end];
  return [...Array.from({ length: text.length + 1 }, (_, i) => ({ typed: text.slice(0, i), create: false })), end];
}
