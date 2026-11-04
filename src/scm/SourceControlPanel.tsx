// The Source Control card on the right of the content (spec 11; GIT-002 / GIT-003 / GIT-004 /
// GIT-006 / GIT-007): the changes of the workspace in front under conflicts, staged, changes and
// untracked, each section with its count, a stage-all / unstage-all control and a discard-all
// control, plus or minus and a discard arrow on every row (GIT-003: discarding asks first, worded
// for what goes, with the untracked list scrolling inside the question),
// a commit box (Ctrl+Enter in its message box commits, C10-R2-01), the main button that always proposes
// the next step, a remote menu whose labels carry counts and whose disabled items say why, and a
// notice when an action fails or a hook refuses a commit, with a Fix with AI action. The draft
// message is the window's, keyed by worktree, so it survives closing the panel and switching
// workspaces. Every call names the worktree. VIEW-067: every row and every section but Conflicts
// can be discarded, always after a prompt that says what will happen. VIEW-068: a branch summary on top (ahead / behind
// the base and the lines changed, split into source, tests and generated).
// Rows select on click (Ctrl adds, Shift spans), and a bulk bar above the list says how many of
// the selected rows Stage and Unstage will each cover (T-018-c); Escape clears the selection.
// GIT-001 (T-033-b): the list refreshes after each action and whenever git state moves, a commit
// or checkout typed in a terminal included, through the git status watcher (watch.ts). GIT-021 / GIT-023: the pull-request step looks the
// branch's pull request up through gh once it is published, and Create pull request opens a composer.
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import Ask from "../chrome/Ask";
import { ChevronDown, Close, FileCode, Funnel, List, Minus, Plus, Refresh, Spark, Stop, Undo } from "../chrome/icons";
import { useSettings } from "../settings/useSettings";
import { aiShownFor, fixRequest, recipeFor, refForDir, REPO_AI_KEY, repoAiMode, withRepoAi, type FixLaunch, type FixPlan, type RepoRef } from "./recipes";
import { readRepoRef } from "./repoId";
import { dismissGenerate, generate, genState, genSubscribe, genVersion, stopGenerate, writerName, writerUsable, DEFAULT_WRITER, type Writer } from "./generate";
import type { AgentInfo } from "../launch/PlusMenu";
import HandoffNote from "./HandoffNote";
import FileOpenWith from "./FileOpenWith";
import FailureNotice, { type Failure } from "./FailureNotice";
import { forkNotice, loadPushTarget, type PushTarget } from "./forkPush";
import { watchStatus } from "./watch";
import { afterRefresh, commitBox, mainStep, noErrors, statusGuard, afterReload, type PanelErrors } from "./rules";
import { DIFF_SPLITS, type DiffSplit } from "./split";
import { openInBrowser } from "../browser/openIn";
import { HistoryLoads, acceptHistory, historyFor, type LoadedHistory } from "./history";
import { LINES_SKIPPED_NOTE, canCommit, changeCount, cutBanner, conflictPrompt, grouped, savedFixAgent, isCommitShortcut, nextStep, remoteItems, summaryLabel, summaryRows, summaryTotal, type ActionOutcome, type Change, type CommitOutcome, type RemoteAction, type Status, type Summary, bulk, rowOrder, rowKeys, selectRows, spanRuns, type RowKey, discardAsk, type DiscardAsk, type Section, mergeActions, mergeLabel, type MergeAction, type MergeInfo, abortLabel, capped, clashWord, CONFLICT_CAP, filesWord, graph, graphLines, commitUrl, explainPrompt, type Commit, type GraphRow, prMismatch, prStateWord, scmGroups, prLooked, prRefreshDelay, PR_STALE_MS, prReason, prRowText, withPr, needsGitHub, type Pr, type PrAnswer, type PrLook, commitItems, failureTitle, discardPlan, fileTree, reviewPrompt, SECTION_CAP, tooManyLine, filterRows, fullPath } from "./model";

type Props = {
  /** Row 838: a status to show before the first read (tests render without a back end). */
  initialStatus?: Status;
  /** The workspace in front; null outside any workspace. */
  dir: string | null;
  draft: string;
  onDraft: (text: string, dir?: string) => void;
  /** GIT-018: who writes commit messages. */
  writer?: Writer;
  onClose: () => void;
  /** GIT-004: starts an agent primed with what git and its hooks printed. */
  /** VIEW-066: false when Source Control AI actions are hidden; the agent fix after a failed push goes with them. */
  aiShown?: boolean;
  onFix: (output: string, launch?: FixLaunch) => void;
  /** VIEW-068: the base pinned for the workspace's project, which the summary measures against. */
  pinnedBase: string | null;
  /** GIT-011: Change Base Ref pins a new base for the workspace's project (blank goes back to the default). */
  onChangeBase?: (base: string) => void;
  /** VIEW-068: the off-by-default setting to measure the summary against the upstream instead. */
  againstUpstream: boolean;
  /** GIT-066: the saved group order (`SCM_GROUP_ORDER_KEY`). */
  groupOrder?: unknown;
  onAgainstUpstream: (on: boolean) => void;
  /** EDIT-040: the agents found on this machine, the default first, for Hand to agent. */
  agents: AgentInfo[];
  onHand: (agent: AgentInfo, note: string) => void;
  /** VIEW-069: the agent saved for agent actions (skips the dialog), saving or clearing it, and the
   *  start itself, which resolves to why it failed (null once the agent has its prompt). */
  fixAgent: unknown;
  onFixAgent: (id: string | null) => void;
  onAgentAction: (agent: AgentInfo, prompt: string) => Promise<string | null>;
  /** GIT-025: the pull request linked by hand to this workspace, and saving or removing it. */
  linkedPr: string | null;
  onLinkPr: (url: string | null) => void;
  /** GIT-001: the flat list (the default) or the folder tree, remembered as a setting. */
  view?: "list" | "tree";
  onView?: (view: "list" | "tree") => void;
  /** GIT-037: a plain click on a changed file opens its diff in the cell's preview tab. */
  onOpenDiff?: (path: string, staged: boolean) => void;
  /** GIT-037 (T-033-c): which split that diff opens in, remembered as a setting (`DIFF_SPLIT_KEY`). */
  diffSplit?: DiffSplit;
  onDiffSplit?: (split: DiffSplit) => void;
  /** GIT-038: every change in one scrolling tab. */
  onAllChanges?: () => void;
  /** GIT-041: the review notes section, drawn above History. */
  notesSection?: ReactNode;
};

type Asking = { agent: string; prompt: string; remember: boolean; title?: string; edited?: boolean };

const LANE = 12;
const ROW = 22;

/** GIT-035: one row of the lane graph. */
function GraphCell({ row }: { row: GraphRow }) {
  const x = (i: number) => i * LANE + LANE / 2;
  const width = Math.max(row.lanesIn.length, row.lanesOut.length, row.col + 1) * LANE;
  return (
    <svg className="scm-graph" width={width} height={ROW} aria-hidden="true">
      {graphLines(row).map((l, i) => (
        <line key={i} x1={x(l.from)} y1={l.top ? 0 : ROW / 2} x2={x(l.to)} y2={l.bottom ? ROW : ROW / 2} className={`c${l.color % 6}`} />
      ))}
      <circle cx={x(row.col)} cy={ROW / 2} r={3.5} className={`c${row.color % 6}`} />
    </svg>
  );
}


type Composer = { title: string; body: string; base: string; draft: boolean; error: string | null; busy: boolean };

// VIEW-069: an agent action runs once at a time; the button stays greyed until the start has an answer.
export default function SourceControlPanel({ dir, initialStatus, writer = DEFAULT_WRITER, draft, onDraft, onClose, onFix, aiShown = true, pinnedBase, onChangeBase, againstUpstream, groupOrder, onAgainstUpstream, agents, onHand, fixAgent, onFixAgent, onAgentAction, linkedPr, onLinkPr, view = "list", onView, onOpenDiff, diffSplit = "here", onDiffSplit, onAllChanges, notesSection }: Props) {
  const [asking, setAsking] = useState<Asking | null>(null);
  // GIT-003: the rows waiting for a yes before their work is thrown away, with the workspace they
  // were picked in (T-615): the yes only ever acts there.
  const [discardingRows, setDiscardingRows] = useState<{ dir: string | null; rows: Change[] } | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const starting = useRef(false);
  const [busyAgent, setBusyAgent] = useState(false);
  const saved = savedFixAgent(agents, fixAgent);
  const runAgent = async (agent: AgentInfo, prompt: string) => {
    if (starting.current) return;
    starting.current = true;
    setBusyAgent(true);
    setAgentError(null);
    const why = await onAgentAction(agent, prompt);
    starting.current = false;
    setBusyAgent(false);
    if (why) setAgentError(why);
  };
  const resolveConflicts = (files: Change[]) => {
    const prompt = conflictPrompt(files);
    if (saved) return void runAgent(saved, prompt);
    setAsking({ agent: agents[0]?.id ?? "", prompt, remember: false });
  };
  // GIT-036: Open in browser shows the commit's GitHub page in a built-in browser tab; it is offered
  // only when the workspace's project is on GitHub.
  const [ghRepo, setGhRepo] = useState<{ host: string; owner: string; name: string } | null>(null);
  useEffect(() => {
    setGhRepo(null);
    invoke<{ host: string; owner: string; name: string } | null>("scm_github_repo", { worktree: dir })
      .then(setGhRepo)
      .catch(() => setGhRepo(null));
  }, [dir]);
  // GIT-017: Claude Code writes the message from what is staged; the run belongs to this worktree.
  useSyncExternalStore(genSubscribe, genVersion, genVersion);
  const gen = dir === null ? null : genState(dir);
  // GIT-019: the generate and Fix with AI controls follow the global switch and this repository's own mode.
  const { settings: appSettings, save: saveSettings } = useSettings();
  // Row 917: keyed by the provider-neutral repository id; null until it is read for this folder, which keeps AI off while any repository is switched off.
  const [read, setRead] = useState<{ dir: string; ref: RepoRef | null } | null>(null);
  useEffect(() => {
    let live = true;
    if (dir !== null) void readRepoRef(dir).then((r) => live && setRead({ dir, ref: r }));
    return () => {
      live = false;
    };
  }, [dir]);
  const repoRef = dir === null ? null : refForDir(read, dir);
  const repoOff = repoRef !== null && repoAiMode(appSettings, repoRef) === "off";
  const aiOn = aiShownFor(appSettings, repoRef);
  // GIT-019: a recipe for the action wins over the single writer; the Rust side expands its variables.
  const commitRecipe = recipeFor(appSettings, "commit");
  const fixRecipe = recipeFor(appSettings, "fix");
  const canGenerate = aiOn && writerUsable(writer, agents, commitRecipe);
  // GIT-019: Fix with AI through the fix recipe: an agent recipe starts that agent with its extra arguments
  // (the app's own launch); a command template runs and what it printed is shown.
  const fix = async (output: string) => {
    if (fixRecipe === null || dir === null) return onFix(output);
    try {
      const plan = await invoke<FixPlan>("scm_recipe_fix", { worktree: dir, recipe: fixRecipe, output, prompt: fixRequest(output) });
      if (plan.kind === "agent") onFix(output, { agent: plan.agent, extra: plan.extra, prompt: plan.prompt });
      else setAgentError(plan.text);
    } catch (e) {
      setAgentError(String(e));
    }
  };
  // GIT-036: Explain changes starts an agent with a prompt about the commit.
  const explain = (c: Commit) => {
    const prompt = explainPrompt(c);
    if (saved) return void runAgent(saved, prompt);
    if (agents.length === 0) return setAgentError("No agent was found on this computer, so nothing can explain this commit.");
    setAsking({ agent: agents[0].id, prompt, remember: false, title: "Explain changes with an agent" });
  };
  // GIT-016: Review changes asks an agent to check the branch, naming the base and the changed files.
  const review = () => {
    const base = summary?.against ?? status?.base ?? "the base branch";
    const prompt = reviewPrompt(base, summary?.committed ?? [], summary?.files ?? 0, status ? rowOrder(status, groupOrder) : []);
    if (prompt === null) return setInfo("This branch has no changes to look at yet, so no agent was started.");
    if (saved) return void runAgent(saved, prompt);
    if (agents.length === 0) return setAgentError("No agent was found on this computer, so nothing can review this branch.");
    setAsking({ agent: agents[0].id, prompt, remember: false, title: "Review changes with an agent" });
  };
  const confirmAsk = () => {
    const a = asking && agents.find((x) => x.id === asking.agent);
    if (!asking || !a || !asking.prompt.trim()) return;
    if (asking.remember) onFixAgent(a.id);
    setAsking(null);
    void runAgent(a, asking.prompt);
  };
  const [status, setStatus] = useState<Status | null>(initialStatus ?? null);
  const statusRef = useRef<Status | null>(null);
  statusRef.current = status;
  const cut = cutBanner(status);
  // C10-R4-01: an action's failure and a status read's are separate slots, because the reload that
  // always follows an action used to clear the message the catch had just set.
  const [errs, setErrs] = useState<PanelErrors>(noErrors);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [closedDirs, setClosedDirs] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<RowKey | null>(null);
  const remoteButton = useRef<HTMLButtonElement>(null);
  const [discarding, setDiscarding] = useState<(DiscardAsk & { section: Section }) | null>(null);

  // VIEW-062: an older answer never overwrites a newer one; a failed refresh keeps the last good status.
  const guard = useRef(statusGuard());
  const load = useCallback(async (auto = false) => {
    if (dir === null) {
      setStatus(null);
      return;
    }
    const ticket = guard.current.begin();
    let got: Status | { error: string };
    try {
      got = await invoke<Status>("scm_status", { worktree: dir });
    } catch (err) {
      got = { error: String(err) };
    }
    if (!guard.current.accept(ticket)) return;
    const shown = afterRefresh(statusRef.current, got, auto);
    setStatus(shown.status);
    setErrs((e) => afterReload(e, got));
  }, [dir]);
  useEffect(() => {
    setFailure(null);
    setInfo(null);
    setMenu(null);
    setSelected([]);
    setAnchor(null);
    setDiscarding(null);
    setDiscardingRows(null); // T-615: a question asked in another workspace goes with it
    setErrs(noErrors);
    statusRef.current = null;
    void load();
    if (dir === null) return;
    return watchStatus(dir, (s) => {
      if (!guard.current.accept(guard.current.begin())) return;
      setStatus(s);
      setErrs((e) => ({ ...e, read: null }));
    });
  }, [load, dir]);

  // VIEW-068: the branch summary is measured while the panel is open, when HEAD moves and at
  // least every 30 s; the last one stays on screen while the next is worked out.
  const [summary, setSummary] = useState<Summary | null>(null);
  // GIT-010: the fork the branch pushes to, when it is not the project's own repository.
  const [pushTo, setPushTo] = useState<PushTarget | null>(null);
  const pushKey = status?.branch ? `${status.branch}|${status.upstream ?? ""}` : "";
  useEffect(() => {
    let live = true;
    setPushTo(null);
    if (dir !== null && pushKey) void loadPushTarget(dir).then((t) => live && setPushTo(t));
    return () => {
      live = false;
    };
  }, [dir, pushKey]);
  const [measureTick, setMeasureTick] = useState(0);
  const [baseDraft, setBaseDraft] = useState<string | null>(null);
  useEffect(() => setSummary(null), [dir]);
  const head = status?.head ?? null;
  useEffect(() => {
    if (dir === null) return;
    const measure = () =>
      void invoke<Summary>("scm_summary", { worktree: dir, pinned: pinnedBase, upstream: againstUpstream })
        .then(setSummary)
        .catch(() => setSummary(null));
    measure();
    const timer = window.setInterval(measure, 30000);
    return () => window.clearInterval(timer);
  }, [dir, head, pinnedBase, againstUpstream, measureTick]);

  /** Runs one back-end call with the busy flag held, then reloads. */
  const guarded = async (work: () => Promise<void>) => {
    if (dir === null || busy) return;
    setBusy(true);
    setInfo(null);
    setErrs((e) => ({ ...e, action: null }));
    try {
      await work();
      setErrs((e) => ({ ...e, read: null }));
    } catch (err) {
      // C10-R4-01: its own slot, so the reload in `finally` cannot clear it in the same call.
      setErrs((e) => ({ ...e, action: String(err) }));
    } finally {
      setBusy(false);
      await load(true);
    }
  };
  const abortOp = (op: string) =>
    guarded(async () => {
      await invoke("scm_abort", { worktree: dir });
      setInfo(`${abortLabel(op)}: the workspace is back where it was`);
    });
  // GIT-015: a card per conflicted file with its kind of clash, and the abort that matches the
  // operation in progress; a long list draws the first CONFLICT_CAP.
  const conflictCards = () => {
    if (!status || (status.conflicts.length === 0 && !status.operation)) return null;
    const { shown, more } = capped(status.conflicts, CONFLICT_CAP);
    return (
      <div className="scm-sec-wrap" data-section="Conflicts">
        <div className="scm-sec">
          <span>{status.conflicts.length > 0 ? "Conflicts" : `${status.operation} in progress`}</span>
          {status.conflicts.length > 0 && <span className="count">{status.conflicts.length}</span>}
          {status.operation && (
            <button className="btn" data-abort={status.operation} disabled={busy} onClick={() => void abortOp(status.operation ?? "")}>
              {abortLabel(status.operation)}
            </button>
          )}
        </div>
        {shown.map((r) => (
          <div key={r.path} className="scm-row scm-clash" data-clash={r.status} title={r.path}>
            <span className="path">{r.path}</span>
            <span className="clash">
              {clashWord(r.status)}
              {status.resolved.includes(r.path) ? " · resolved here, stage it" : ""}
            </span>
            <button className="ib" title="Stage as resolved" disabled={busy} onClick={() => void stage([r.path], true)}>
              <Plus />
            </button>
          </div>
        ))}
        {more > 0 && <div className="sb-hint">and {more} more</div>}
      </div>
    );
  };
  const stage = (paths: string[], on: boolean) => paths.length > 0 && guarded(() => invoke("scm_stage", { worktree: dir, paths, on }));
  const askDiscard = (section: Section, rows: Change[], all: boolean) => rows.length > 0 && setDiscarding({ ...discardAsk(section, rows, all), section });
  const discard = (d: DiscardAsk & { section: Section }) => {
    setDiscarding(null);
    const section = d.section === "Changes" ? "changed" : d.section.toLowerCase();
    void guarded(() => invoke("scm_discard", { worktree: dir, section, paths: d.paths }));
  };
  // GIT-003: rows picked across sections go through the section-free discard.
  const discardRows = (rows: Change[]) => rows.length > 0 && !busy && setDiscardingRows({ dir, rows });
  const confirmDiscard = () => {
    const asked = discardingRows;
    setDiscardingRows(null);
    if (!asked || asked.dir !== dir) return; // T-615: never same-named files in the workspace shown now
    void guarded(() => invoke("scm_discard", { worktree: dir, paths: asked.rows.map((r) => r.path) }));
  };
  const commit = () =>
    canCommit(status, draft) &&
    guarded(async () => {
      const out = await invoke<CommitOutcome>("scm_commit", { worktree: dir, message: draft });
      if (out.id) {
        onDraft("");
        setFailure(null);
        setInfo(`Committed ${out.id}`);
      } else {
        setFailure({ title: out.blocked ? "Commit blocked by a hook" : "Commit failed", output: out.output });
      }
    });
  // GIT-009: a failed action names its kind; only a hook failure is offered to an agent, with the
  // hook's output and the pushed files.
  const runRemote = async (action: RemoteAction, label: string) => {
    const out = await invoke<ActionOutcome>("scm_remote", { worktree: dir, action });
    if (out.ok) {
      setFailure(null);
      setInfo(`${label}: done`);
    } else {
      setFailure({ title: failureTitle(label, out), output: out.output, fix: out.kind === "hook" ? (out.detail ?? out.output) : !out.kind || out.kind === "other" ? out.output : null, policy: out.kind === "no-policy", behind: out.kind === "non-fast-forward" });
    }
  };
  const remote = (action: RemoteAction, label: string) => guarded(() => runRemote(action, label));
  // GIT-005: commit, then the remote step; a commit that fails pushes nothing.
  const commitThen = (action: RemoteAction, label: string) =>
    guarded(async () => {
      const out = await invoke<CommitOutcome>("scm_commit", { worktree: dir, message: draft });
      if (!out.id) return setFailure({ title: out.blocked ? "Commit blocked by a hook; nothing was pushed" : "Commit failed; nothing was pushed", output: out.output });
      onDraft("");
      await runRemote(action, `Committed ${out.id}; ${label}`);
    });
  const [commitMenu, setCommitMenu] = useState<{ left: number; top: number } | null>(null);
  const commitButton = useRef<HTMLButtonElement>(null);

  // GIT-021: the branch's pull request, looked up once it is published and off the base branch.
  const [look, setLook] = useState<PrLook>({ loading: false, pr: null, error: null });
  const [composer, setComposer] = useState<Composer | null>(null);
  const lookable = status !== null && status.branch !== null && status.upstream !== null && status.base !== status.branch && status.base !== `origin/${status.branch}`;
  // A hand link is looked up wherever the workspace is, the default branch included.
  const lookKey = linkedPr ? `${dir}|link|${linkedPr}` : lookable ? `${dir}|${status?.branch}|${status?.upstream}` : null;
  // GIT-027: failures in a row and when the last answer came, for the next lookup's timing.
  const [looked, setLooked] = useState({ at: 0, fails: 0 });
  const lookUp = useCallback(() => {
    if (dir === null) return;
    setLook((l) => ({ ...l, loading: true }));
    invoke<PrAnswer>("scm_pr", { worktree: dir, linked: linkedPr })
      .then((answer) => {
        setLook((l) => prLooked(l, answer));
        setLooked({ at: Date.now(), fails: 0 });
      })
      .catch((err) => {
        setLook((l) => prLooked(l, { error: String(err) }));
        setLooked((x) => ({ at: Date.now(), fails: x.fails + 1 }));
      });
  }, [dir, linkedPr]);
  const [linking, setLinking] = useState<{ url: string; error: string | null } | null>(null);
  useEffect(() => setLinking(null), [dir]);
  // GIT-025: a link is checked through gh before it is kept.
  const linkPr = async () => {
    if (!linking || dir === null) return;
    try {
      const answer = await invoke<PrAnswer>("scm_pr", { worktree: dir, linked: linking.url.trim() });
      // A remote that is not GitHub was not asked, so nothing was checked: keep no link.
      const block = needsGitHub("Linking", answer.provider, answer.host);
      if (block) return setLinking({ ...linking, error: block });
      onLinkPr(linking.url.trim());
      setLinking(null);
      setLook({ loading: false, pr: answer.pr, error: null });
    } catch (err) {
      setLinking({ ...linking, error: String(err) });
    }
  };
  const mismatch = prMismatch(look.pr, status?.branch ?? null);
  useEffect(() => {
    setComposer(null);
    setLooked({ at: 0, fails: 0 });
    // Another workspace or branch starts blank, so its first failure never shows the last one's.
    setLook({ loading: false, pr: null, error: null });
    if (lookKey === null) return;
    lookUp();
  }, [lookKey, lookUp]);
  // GIT-027: looked up again by itself while the window is in view, later after each failure;
  // a window that comes back with an old answer looks it up at once.
  useEffect(() => {
    if (lookKey === null || looked.at === 0) return;
    const timer = window.setTimeout(() => document.visibilityState === "visible" && lookUp(), prRefreshDelay(looked.fails));
    const back = () => document.visibilityState === "visible" && Date.now() - looked.at >= PR_STALE_MS && lookUp();
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [lookKey, looked, lookUp]);
  const openPr = (pr: Pr) => void invoke("scm_open_pr", { url: pr.url }).catch((err) => setErrs((e) => ({ ...e, read: String(err) })));
  const startPr = () => {
    if (look.pr?.state === "OPEN") return openPr(look.pr);
    setComposer({ title: "", body: "", base: (status?.base ?? "").replace(/^origin\//, ""), draft: false, error: null, busy: false });
  };
  // A failed create keeps everything typed next to the error.
  const createPr = async () => {
    if (!composer || dir === null || composer.busy) return;
    setComposer({ ...composer, busy: true, error: null });
    try {
      const pr = await invoke<Pr>("scm_pr_create", { worktree: dir, title: composer.title, body: composer.body, base: composer.base, draft: composer.draft });
      setComposer(null);
      setLook({ loading: false, pr, error: null });
      setFailure(null);
      setInfo(`Pull request #${pr.number} is open on GitHub`);
    } catch (err) {
      setComposer((c) => c && { ...c, busy: false, error: String(err) });
    }
    void load();
  };
  const prItemReason = look.pr?.state === "OPEN" ? null : prReason(status, look);
  // GIT-033: the merge box reads the merge state when it is opened and again after each action.
  // C10-R1-01: the box keeps the pull request it read, so its buttons and its target are one
  // reading; another pull request on the same branch closes it instead of retargeting its click.
  const [merge, setMerge] = useState<{ url: string; info: MergeInfo | null; error: string | null; busy: boolean; armed: string | null } | null>(null);
  useEffect(() => setMerge(null), [lookKey, look.pr?.url]);
  const loadMerge = (url: string) => {
    if (dir === null) return;
    setMerge((m) => ({ url, info: m?.url === url ? m.info : null, error: null, busy: true, armed: null }));
    invoke<MergeInfo>("scm_merge_info", { worktree: dir, url })
      .then((info) => setMerge((m) => (m && m.url === url ? { ...m, info, error: null, busy: false, armed: null } : m)))
      .catch((err) => setMerge((m) => (m && m.url === url ? { ...m, error: String(err), busy: false, armed: null } : m)));
  };
  const actKey = (a: MergeAction) => `${a.action}:${a.method ?? ""}`;
  // A merge cannot be undone, so it asks once more in place.
  const runMerge = async (a: MergeAction) => {
    if (dir === null || !merge || merge.busy) return;
    if (a.action === "merge" && merge.armed !== actKey(a)) return setMerge({ ...merge, armed: actKey(a) });
    const url = merge.url;
    setMerge({ ...merge, busy: true, error: null });
    try {
      await invoke("scm_merge", { worktree: dir, url, action: a.action, method: a.method });
    } catch (err) {
      return setMerge((m) => m && { ...m, busy: false, armed: null, error: String(err) });
    }
    loadMerge(url);
    lookUp();
  };

  const main = mainStep(withPr(nextStep(status, draft), status, look), status, look);
  const step = main.step;
  const box = commitBox(status);

  // GIT-035: the history section loads while it is open, again when HEAD moves or on refresh.
  const [histOpen, setHistOpen] = useState(false);
  const [histTick, setHistTick] = useState(0);
  // VIEW-071: a load is tagged with its worktree and number, so a slow one never replaces a newer one and another worktree's list is never drawn.
  const [loadedHist, setLoadedHist] = useState<LoadedHistory | null>(null);
  const histLoads = useRef(new HistoryLoads());
  const history = historyFor(loadedHist, dir);
  const [picked, setPicked] = useState<{ hash: string; files: Change[] | null } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; commit: Commit } | null>(null);
  // GIT-014: the changes filter (Escape empties and closes it) and a changed file's menu.
  const [filter, setFilter] = useState<string | null>(null);
  const [fileCtx, setFileCtx] = useState<{ x: number; y: number; path: string } | null>(null);
  useEffect(() => {
    histLoads.current.begin();
    setLoadedHist(null);
    setPicked(null);
  }, [dir]);
  useEffect(() => {
    if (!histOpen || dir === null) return;
    const seq = histLoads.current.begin();
    invoke<Commit[]>("scm_history", { worktree: dir })
      .then((commits) => setLoadedHist((shown) => acceptHistory(histLoads.current, seq, dir, commits, shown)))
      .catch((err) => setErrs((e) => ({ ...e, read: String(err) })));
  }, [histOpen, dir, head, histTick]);
  const rows = history ? graph(history) : [];
  const pickCommit = (c: Commit) => {
    if (picked?.hash === c.hash) return setPicked(null);
    setPicked({ hash: c.hash, files: null });
    invoke<Change[]>("scm_commit_files", { worktree: dir, hash: c.hash })
      .then((files) => setPicked((p) => (p?.hash === c.hash ? { hash: c.hash, files } : p)))
      .catch((err) => setErrs((e) => ({ ...e, read: String(err) })));
  };
  const copy = (text: string, what: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => setInfo(`Copied the ${what}`))
      .catch(() => setErrs((e) => ({ ...e, read: `Could not copy the ${what}` })));
  const mainAction = () => {
    if (!status) return;
    switch (step.action) {
      case "stage":
        // GIT-012: with the lists cut short, "Stage all" means the whole worktree, not the rows shown.
        return stage((status.cut ?? 0) > 0 ? ["."] : [...status.changed, ...status.untracked].map((c) => c.path), true);
      case "commit":
        return commit();
      case "pr":
        return startPr();
      default:
        return remote(step.action, step.label);
    }
  };
  const openMenu = () => {
    const r = remoteButton.current?.getBoundingClientRect();
    if (r) setMenu({ left: Math.max(8, r.right - 250), top: r.bottom + 4 });
  };

  // FIX-BEFORE-2: the rows on screen, in the order drawn (saved group order, filter, cap, closed
  // folders), so a span and the bulk bar only ever cover rows the user can see.
  // FIX-3: rows are keyed by (section, path), so a file drawn in both Changes and Staged is two rows
  // and a span covers exactly the rows between the two clicks.
  const drawnKeys = status ? rowKeys(status, groupOrder, { filter: filter ?? "", tree: view === "tree" ? closedDirs : null }) : [];
  const drawnOrder = [...new Set(drawnKeys.map((k) => k.path))];
  const pick = (row: RowKey, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (!status) return;
    setSelected((prev) => selectRows(prev, drawnKeys, row, e.shiftKey ? "span" : e.ctrlKey || e.metaKey ? "toggle" : "one", anchor));
    // A Shift-click that could not span (no anchor, or the anchor row is hidden) becomes the new anchor.
    if (!e.shiftKey || !spanRuns(drawnKeys, row, anchor)) setAnchor(row);
  };
  const chosen = status ? bulk(status, selected.filter((p) => drawnOrder.includes(p)), groupOrder) : { present: [], stage: [], unstage: [] };
  const plan = discardingRows && discardPlan(discardingRows.rows);
  const rowsOf = (paths: string[]): Change[] => {
    const all = status ? [...status.conflicts, ...status.staged, ...status.changed, ...status.untracked] : [];
    return paths.flatMap((p) => all.find((c) => c.path === p) ?? []);
  };

  // GIT-001: a file's lines added and removed in this section; a binary file shows none.
  const countsOf = (name: "Conflicts" | Section, path: string) => (name === "Staged" ? status?.lines?.staged : name === "Changes" ? status?.lines?.changed : name === "Untracked" ? status?.lines?.untracked : undefined)?.[path];
  const fileRow = (name: "Conflicts" | Section, r: Change, on: boolean, depth: number, label: string) => {
    const n = countsOf(name, r.path);
    return (
      <div
        key={r.path}
        className="scm-row"
        aria-selected={selected.includes(r.path)}
        style={depth ? { paddingLeft: 6 + depth * 12 + 12 } : undefined}
        title={r.from ? `${r.from} → ${r.path}` : r.path}
        onContextMenu={(e) => {
          e.preventDefault();
          setFileCtx({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 170), path: r.path });
        }}
        onClick={(e) => {
          pick({ section: name, path: r.path }, e);
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey) onOpenDiff?.(r.path, name === "Staged");
        }}
      >
        <span className="letter">{r.status}</span>
        <span className="path">{label}</span>
        {status?.submodules?.[r.path] && (
          <span className="scm-sub" style={{ fontSize: 10, color: "var(--fg-muted)", marginLeft: 6, whiteSpace: "nowrap" }} data-submodule={r.path} title={`Submodule: ${status.submodules[r.path]}`}>
            submodule · {status.submodules[r.path]}
          </span>
        )}
        {n && (
          <span className="scm-lines" title={`${n[0]} added, ${n[1]} removed`}>
            {n[0] > 0 && <span className="add">+{n[0]}</span>}
            {n[1] > 0 && <span className="del">−{n[1]}</span>}
          </span>
        )}
        {name !== "Conflicts" && (
          <button className="ib" title="Discard" aria-label={`Discard ${r.path}`} disabled={busy} onClick={(e) => { e.stopPropagation(); askDiscard(name, [r], false); }}>
            <Undo />
          </button>
        )}
        <button
          className="ib"
          title={on ? "Stage" : "Unstage"}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void stage([r.path], on);
          }}
        >
          {on ? <Plus /> : <Minus />}
        </button>
      </div>
    );
  };

  const section = (name: "Conflicts" | Section, all: Change[], on: boolean) => {
    const rows = filterRows(all, filter ?? "");
    // VIEW-062: a huge section lists the first SECTION_CAP rows; the counts and bulk buttons still cover all.
    const { shown, more } = capped(rows, SECTION_CAP);
    return rows.length > 0 && (
      <div className="scm-sec-wrap" data-section={name}>
        <div className="scm-sec">
          <span>{name}</span>
          <span className="count">{rows.length}</span>
          {name !== "Conflicts" && (
            <button className="ib" title={`Discard all ${rows.length}`} aria-label={`Discard all in ${name}`} disabled={busy} onClick={() => askDiscard(name, rows, true)}>
              <Undo />
            </button>
          )}
          <button className="ib" title={on ? `Stage all ${rows.length}` : `Unstage all ${rows.length}`} disabled={busy} onClick={() => void stage(rows.map((r) => r.path), on)}>
            {on ? <Plus /> : <Minus />}
          </button>
        </div>
        {view === "tree"
          ? fileTree(shown, new Set([...closedDirs].filter((k) => k.startsWith(name + "/")).map((k) => k.slice(name.length + 1)))).map((i) =>
              i.kind === "file" ? (
                fileRow(name, i.change, on, i.depth, i.name)
              ) : (
                <div key={`dir:${i.path}`} className="scm-row scm-dir" style={{ paddingLeft: 6 + i.depth * 12 }} title={i.path} onClick={() => setClosedDirs((c) => { const n = new Set(c); if (!n.delete(name + "/" + i.path)) n.add(name + "/" + i.path); return n; })}>
                  <span className={closedDirs.has(name + "/" + i.path) ? "chev shut" : "chev"} aria-hidden="true"><ChevronDown size={10} /></span>
                  <span className="path">{i.name}</span>
                  <span className="count">{i.files.length}</span>
                  <button
                    className="ib"
                    title={on ? `Stage the ${i.files.length} in ${i.path}` : `Unstage the ${i.files.length} in ${i.path}`}
                    aria-label={`${on ? "Stage" : "Unstage"} folder ${i.path}`}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void stage(i.files, on);
                    }}
                  >
                    {on ? <Plus /> : <Minus />}
                  </button>
                </div>
              ),
            )
          : shown.map((r) => fileRow(name, r, on, 0, r.from ? `${r.from} → ${r.path}` : r.path))}
        {more > 0 && <div className="sb-hint" role="note">{tooManyLine(more)}</div>}
      </div>
    );
  };

  return (
    <aside
      className="sidebar-wrap right"
      onKeyDown={(e) => {
        // Escape clears the selection. The commit shortcut is not the panel's: it belongs to the
        // commit message box alone (C10-R2-01), so a Ctrl+Enter typed in the handoff note or a
        // pull request description stays that field's own key.
        if (e.key === "Escape" && selected.length > 0) setSelected([]);
      }}
    >
      {discarding && <Ask title={discarding.title} body={discarding.body} confirm={discarding.confirm} onConfirm={() => discard(discarding)} onCancel={() => setDiscarding(null)} />}
      <div className="sidebar scm">
        <div className="sb-section scm-head">
          <span>Source Control</span>
          {status && <span className="count">{changeCount(status)}</span>}
          <div className="icons">
            {dir !== null && (
              <button className="ib" title="Review changes: an agent checks the branch before it ships" aria-label="Review changes" disabled={busyAgent} onClick={review}>
                <Spark />
              </button>
            )}
            {onDiffSplit && (
              <select className="scm-split" aria-label="Open diffs in" title="Which split a clicked file's diff opens in" value={diffSplit} onChange={(e) => onDiffSplit(e.target.value as DiffSplit)}>
                {DIFF_SPLITS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            {onAllChanges && (
              <button className="ib" title="All changes: every changed file's diff in one tab" aria-label="All changes" onClick={onAllChanges}>
                <FileCode />
              </button>
            )}
            <button className="ib" title="Filter the changes" aria-label="Filter the changes" aria-pressed={filter !== null} onClick={() => setFilter((f) => (f === null ? "" : null))}>
              <Funnel />
            </button>
            {onView && (
              <button className="ib" title={view === "tree" ? "View as list" : "View as tree"} aria-label={view === "tree" ? "View as list" : "View as tree"} aria-pressed={view === "tree"} onClick={() => onView(view === "tree" ? "list" : "tree")}>
                <List />
              </button>
            )}
            <button className="ib" title="Refresh" onClick={() => void load()}>
              <Refresh />
            </button>
            <button className="ib" title="Close" onClick={onClose}>
              <Close />
            </button>
          </div>
        </div>
        {dir === null ? (
          <div className="sb-hint">Open a workspace to see its changes.</div>
        ) : (
          <>
            {summary && (
              <details className="scm-summary" data-summary>
                <summary aria-label={summaryLabel(status?.branch ?? null, summary)} title={`against ${summary.against}`}>
                  <span className="branch">{status?.branch ?? "Detached HEAD"}</span>
                  <span className="ab">
                    ↑{summary.ahead} ↓{summary.behind} {summary.against}
                  </span>
                  <span className="files" data-files={summary.files}>
                    {filesWord(summary.files)}
                  </span>
                  <span className="lines">
                    {summary.linesSkipped ? (
                      LINES_SKIPPED_NOTE
                    ) : (
                      <>
                        <span className="add">+{grouped(summaryTotal(summary).added)}</span> <span className="del">−{grouped(summaryTotal(summary).removed)}</span>
                      </>
                    )}
                  </span>
                </summary>
                {(summary.linesSkipped ? [] : summaryRows(summary)).map((r) => (
                  <div key={r.label} className="scm-sum-row" data-row={r.label}>
                    <span>{r.label}</span>
                    <span className="add">+{grouped(r.added)}</span>
                    <span className="del">−{grouped(r.removed)}</span>
                  </div>
                ))}
                <label className="check">
                  <input type="checkbox" aria-label="compare with the upstream" checked={againstUpstream} onChange={(e) => onAgainstUpstream(e.target.checked)} />
                  Compare with the upstream{pinnedBase ? ` (the pinned base ${pinnedBase} wins)` : ""}
                </label>
                <div className="btn-row" data-base-ref>
                  {baseDraft === null ? (
                    <>
                      {onChangeBase && (
                        <button className="btn" onClick={() => setBaseDraft(pinnedBase ?? "")}>
                          Change Base Ref…
                        </button>
                      )}
                      <button className="btn" onClick={() => setMeasureTick((t) => t + 1)}>
                        Refresh branch compare
                      </button>
                    </>
                  ) : (
                    <form
                      className="btn-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        onChangeBase?.(baseDraft);
                        setBaseDraft(null);
                      }}
                    >
                      <input className="field" aria-label="base ref" placeholder={`blank: ${status?.base ?? "the default branch"}`} value={baseDraft} onChange={(e) => setBaseDraft(e.target.value)} autoFocus />
                      <button className="btn primary" type="submit">
                        Compare
                      </button>
                      <button className="btn" type="button" onClick={() => setBaseDraft(null)}>
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
                {summary.committed.length > 0 && (
                  <div className="scm-sec-wrap" data-committed>
                    <div className="scm-sec">
                      <span>Committed on this branch</span>
                      <span className="count">{summary.files}</span>
                    </div>
                    {summary.committed.map((r) => (
                      <div key={r.path} className="scm-row" title={r.from ? `${r.from} → ${r.path}` : r.path}>
                        <span className="letter">{r.status}</span>
                        <span className="path">{r.from ? `${r.from} → ${r.path}` : r.path}</span>
                      </div>
                    ))}
                    {summary.files > summary.committed.length && <div className="sb-hint">and {summary.files - summary.committed.length} more</div>}
                  </div>
                )}
              </details>
            )}
            <div className="scm-commit">
              <div className="scm-msg">
                <textarea
                  className="field multi"
                  aria-label="Commit message"
                  placeholder={status?.branch ? `Message (Ctrl+Enter to commit on ${status.branch})` : "Message (Ctrl+Enter to commit)"}
                  value={draft}
                  disabled={box.boxDisabled}
                  title={box.why ?? undefined}
                  onChange={(e) => onDraft(e.target.value)}
                  // C10-R2-01: the shortcut is this field's own, so Ctrl+Enter here commits and the
                  // same chord in any other box does what that box does; the native event is passed
                  // so a key still part of an input-method composition never commits.
                  onKeyDown={(e) => {
                    if (!isCommitShortcut(e.nativeEvent)) return;
                    e.preventDefault();
                    void commit();
                  }}
                />
                {gen === "running" ? (
                  <button className="ib scm-gen" title="Stop writing the message" aria-label="Stop writing the message" onClick={() => dir !== null && void stopGenerate(dir)}>
                    <Stop />
                  </button>
                ) : (
                  canGenerate &&
                  (status?.staged.length ?? 0) > 0 && (
                    <button className="ib scm-gen" title={`Write the message from what is staged with ${writer.mode === "custom" ? "your command" : writerName(writer.agent)}`} aria-label="Write the message with AI" onClick={() => dir !== null && generate(dir, onDraft, writer, commitRecipe)}>
                      <Spark />
                    </button>
                  )
                )}
              </div>
              {gen !== null && gen !== "running" && (
                <div className="note warn" role="status">
                  {gen}{" "}
                  <button type="button" className="link" onClick={() => dir !== null && dismissGenerate(dir)}>
                    Dismiss
                  </button>
                </div>
              )}
              {aiShown && repoRef !== null && (
                <div className="sb-hint">
                  <button type="button" className="link" title={`This repository's AI switch is saved as ${typeof repoRef === "string" ? repoRef : repoRef.id}`} onClick={() => void saveSettings({ [REPO_AI_KEY]: withRepoAi(appSettings, repoRef, repoOff ? "follow" : "off") })}>
                    {repoOff ? "Follow the global AI setting for this repository" : "Turn AI off for this repository"}
                  </button>
                  <span> Repository: {typeof repoRef === "string" ? repoRef : repoRef.id}</span>
                </div>
              )}
              <div className="scm-main" hidden={box.controlsHidden}>
                <button className="btn primary" title={step.reason ?? step.label} disabled={busy || step.reason !== null} onClick={() => void mainAction()}>
                  <span>{step.label}</span>
                </button>
                <button
                  ref={commitButton}
                  className="btn"
                  title="Commit and push, sync or force push"
                  aria-label="Commit and"
                  aria-haspopup="menu"
                  aria-expanded={commitMenu !== null}
                  disabled={busy}
                  onClick={() => {
                    const r = commitButton.current?.getBoundingClientRect();
                    if (r) setCommitMenu({ left: Math.max(8, r.right - 280), top: r.bottom + 4 });
                  }}
                >
                  <ChevronDown />
                </button>
                <button ref={remoteButton} className="btn" title="Remote actions" aria-haspopup="menu" aria-expanded={menu !== null} disabled={busy} onClick={openMenu}>
                  Remote <ChevronDown />
                </button>
              </div>
            </div>
            {commitMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setCommitMenu(null)} aria-hidden="true" />
                <div className="menu" role="menu" aria-label="Commit and" style={{ left: commitMenu.left, top: commitMenu.top, width: 280 }}>
                  <div className="menu-title">Commit and</div>
                  {commitItems(status, draft).map((item) => (
                    <button
                      key={item.id}
                      role="menuitem"
                      className="menu-item"
                      data-commit={item.id}
                      disabled={item.reason !== null}
                      title={item.reason ?? item.title}
                      onClick={() => {
                        setCommitMenu(null);
                        void commitThen(item.id, item.label.replace(/^Commit,? (then |and )?/, "").replace(/^./, (c) => c.toUpperCase()));
                      }}
                    >
                      <span className="name">{item.label}</span>
                      {item.reason && <span className="reason">{item.reason}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
            {menu && (
              <>
                <div className="menu-backdrop" onClick={() => setMenu(null)} aria-hidden="true" />
                <div className="menu" role="menu" aria-label="Remote actions" style={{ left: menu.left, top: menu.top }}>
                  <div className="menu-title">{status?.upstream ? `Remote · ${status.upstream}` : "Remote"}</div>
                  {remoteItems(status).map((item) => (
                    <button
                      key={item.id}
                      role="menuitem"
                      className="menu-item"
                      data-action={item.id}
                      disabled={item.reason !== null}
                      title={item.reason ?? item.label}
                      onClick={() => {
                        setMenu(null);
                        void remote(item.id, item.label);
                      }}
                    >
                      <span className="name">{item.label}</span>
                      {item.reason && <span className="reason">{item.reason}</span>}
                    </button>
                  ))}
                  <button
                    role="menuitem"
                    className="menu-item"
                    data-action="pr"
                    disabled={prItemReason !== null}
                    title={prItemReason ?? "Create pull request"}
                    onClick={() => {
                      setMenu(null);
                      startPr();
                    }}
                  >
                    <span className="name">{look.pr?.state === "OPEN" ? `Open pull request #${look.pr.number}` : "Create pull request"}</span>
                    {prItemReason && <span className="reason">{prItemReason}</span>}
                  </button>
                </div>
              </>
            )}
            {status?.branch !== undefined && (
              <div className="scm-prrow" data-pr-row>
                {look.pr ? (
                  <>
                    <button className="btn scm-prnum" title={`Open ${look.pr.url}`} onClick={() => openPr(look.pr as Pr)}>
                      #{look.pr.number}
                    </button>
                    <span className={`scm-prstate ${look.pr.state.toLowerCase()}`}>{prStateWord(look.pr)}</span>
                    <span className="scm-prtitle" title={look.pr.title ?? ""}>
                      {look.pr.title ?? ""}
                    </span>
                  </>
                ) : (
                  <span className="scm-prtitle muted">{prRowText(look, !!lookKey)}</span>
                )}
                {lookKey && (
                  <button className="btn" data-pr-refresh title="Look up the pull request again now" disabled={look.loading} onClick={lookUp}>
                    Refresh
                  </button>
                )}
                {look.pr && (
                  <button className="btn" data-merge-open title="Merge, auto-merge, ready for review, close or reopen" onClick={() => look.pr && loadMerge(look.pr.url)}>
                    Merge{"…"}
                  </button>
                )}
                <button className="btn" title={needsGitHub("Linking", look.provider, look.host) ?? "Link another pull request by its link"} disabled={needsGitHub("Linking", look.provider, look.host) !== null} onClick={() => setLinking({ url: "", error: null })}>
                  Link{"\u2026"}
                </button>
                {linkedPr && (
                  <button className="btn" data-pr-unlink title="Go back to the branch's own pull request" onClick={() => onLinkPr(null)}>
                    Unlink
                  </button>
                )}
              </div>
            )}
            {look.pr && look.error && (
              <div className="note warn" data-pr-stale>
                Could not refresh the pull request: {look.error}. Showing what GitHub said last.
              </div>
            )}
            {mismatch && <div className="note warn">{mismatch}</div>}
            {merge && (
              <div className="scm-ask" data-merge>
                <div className="scm-ask-title" data-merge-label>
                  {merge.info ? mergeLabel(merge.info) : "Checking the merge state…"}
                </div>
                {merge.info && (
                  <div className="btn-row">
                    {mergeActions(merge.info).map((a) => (
                      <button key={actKey(a)} className={["merge", "auto", "queue"].includes(a.action) ? "btn primary" : "btn"} data-merge-action={actKey(a)} disabled={merge.busy} onClick={() => void runMerge(a)}>
                        {merge.armed === actKey(a) ? `Confirm: ${a.label}` : a.label}
                      </button>
                    ))}
                    <button className="btn" onClick={() => setMerge(null)}>
                      Hide
                    </button>
                  </div>
                )}
                {merge.info?.state === "MERGED" && <div className="note">Merged. When you are done here, delete this workspace from its row in the sidebar.</div>}
                {merge.error && (
                  <div className="note error" role="alert">
                    {merge.error}
                  </div>
                )}
              </div>
            )}
            {linking && (
              <form
                className="scm-ask"
                aria-label="Link a pull request"
                onSubmit={(e) => {
                  e.preventDefault();
                  void linkPr();
                }}
              >
                <input className="field" aria-label="pull request link" placeholder="https://github.com/owner/repo/pull/12" value={linking.url} onChange={(e) => setLinking({ url: e.target.value, error: null })} />
                {linking.error && (
                  <div className="note error" role="alert">
                    {linking.error}
                  </div>
                )}
                <div className="btn-row">
                  <button className="btn primary" type="submit" data-pr-link disabled={!linking.url.trim()}>
                    Link
                  </button>
                  <button className="btn" type="button" onClick={() => setLinking(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {composer && (
              <div
                className="scm-ask scm-pr"
                role="dialog"
                aria-label="Create pull request"
                onKeyDown={(e) => {
                  if (e.key !== "Escape" || composer.busy || composer.title.trim() || composer.body.trim()) return;
                  e.stopPropagation();
                  setComposer(null);
                }}
              >
                <input className="field" aria-label="pull request title" autoFocus placeholder="Title" value={composer.title} onChange={(e) => setComposer({ ...composer, title: e.target.value })} />
                <textarea className="field multi" aria-label="pull request description" placeholder="Description" value={composer.body} onChange={(e) => setComposer({ ...composer, body: e.target.value })} />
                <label className="scm-pr-base">
                  <span>Base</span>
                  <input className="field" aria-label="base branch" value={composer.base} onChange={(e) => setComposer({ ...composer, base: e.target.value })} />
                </label>
                <label className="conn-switch">
                  <input type="checkbox" checked={composer.draft} onChange={(e) => setComposer({ ...composer, draft: e.target.checked })} />
                  <span>Open as a draft</span>
                </label>
                {composer.error && (
                  <div className="note error" role="alert">
                    {composer.error}
                  </div>
                )}
                <div className="btn-row">
                  <button className="btn primary" data-pr-create disabled={composer.busy || !composer.title.trim() || !composer.base.trim()} title={!composer.title.trim() ? "Write a title first" : undefined} onClick={() => void createPr()}>
                    {composer.busy ? "Creating…" : `Create${composer.draft ? " draft" : ""} pull request`}
                  </button>
                  <button className="btn" onClick={() => setComposer(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {forkNotice(pushTo) && (
              <div className="note" role="status" data-fork-push>
                {forkNotice(pushTo)}
              </div>
            )}
            {info && (
              <div className="note ok" role="status">
                {info}
              </div>
            )}
            {failure && <FailureNotice failure={failure} busy={busy} aiOn={aiShown && aiOn} onRemote={remote} onCopy={copy} onFix={(o) => void fix(o)} onDismiss={() => setFailure(null)} />}
            {errs.action && (
              <div className="note error" role="alert" data-action-error>
                {errs.action}
              </div>
            )}
            {errs.read && <div className="note error">{errs.read}</div>}
            {status && status.conflicts.length > 0 && (
              <div className="btn-row" data-agent-action="resolve-conflicts">
                <button className="btn" disabled={busyAgent || agents.length === 0} title={agents.length === 0 ? "No agent was found on this computer" : undefined} onClick={() => resolveConflicts(status.conflicts)}>
                  {saved ? `Resolve conflicts with ${saved.name}` : "Resolve conflicts with an agent…"}
                </button>
                {saved && (
                  <button className="btn" title="Pick the agent and check the prompt each time" onClick={() => onFixAgent(null)}>
                    Ask each time
                  </button>
                )}
              </div>
            )}
            {asking && (
              <div
                className="scm-ask"
                role="dialog"
                aria-label={asking.title ?? "Resolve conflicts with an agent"}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.stopPropagation();
                  if (!asking.edited) setAsking(null); // T-708: an edited prompt is closed by Cancel only
                }}
              >
                {asking.title && <div className="scm-ask-title">{asking.title}</div>}
                <select aria-label="agent to start" className="field" autoFocus value={asking.agent} onChange={(e) => setAsking({ ...asking, agent: e.target.value })}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <textarea aria-label="prompt for the agent" className="field multi" value={asking.prompt} onChange={(e) => setAsking({ ...asking, prompt: e.target.value, edited: true })} />
                <label className="conn-switch">
                  <input type="checkbox" checked={asking.remember} onChange={(e) => setAsking({ ...asking, remember: e.target.checked })} />
                  <span>Start this agent without asking next time</span>
                </label>
                <div className="btn-row">
                  <button className="btn primary" disabled={!asking.prompt.trim()} onClick={confirmAsk}>
                    Start
                  </button>
                  <button className="btn" onClick={() => setAsking(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {agentError && (
              <div className="note error" role="alert">
                {agentError}
              </div>
            )}
            {chosen.present.length > 0 && (
              <div className="scm-bulk" role="toolbar" aria-label="Selected rows">
                <span className="count">{chosen.present.length} selected</span>
                <button className="btn" disabled={busy || chosen.stage.length === 0} title={`Stage the ${chosen.stage.length} selected unstaged rows`} onClick={() => void stage(chosen.stage, true)}>
                  Stage {chosen.stage.length}
                </button>
                <button className="btn" disabled={busy || chosen.unstage.length === 0} title={`Unstage the ${chosen.unstage.length} selected staged rows`} onClick={() => void stage(chosen.unstage, false)}>
                  Unstage {chosen.unstage.length}
                </button>
                <button className="btn" disabled={busy} title={`Discard the ${chosen.present.length} selected rows`} onClick={() => discardRows(rowsOf(chosen.present))}>
                  Discard {chosen.present.length}
                </button>
                <button className="ib" title="Clear selection (Esc)" onClick={() => setSelected([])}>
                  <Close />
                </button>
              </div>
            )}
            {filter !== null && (
              <input
                className="field scm-filter"
                style={{ margin: "6px 8px 0", width: "calc(100% - 16px)", boxSizing: "border-box" }}
                aria-label="Filter the changes"
                placeholder="Filter by path"
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.preventDefault();
                  e.stopPropagation();
                  setFilter(null);
                }}
              />
            )}
            {cut && (
              <div className="note warn" role="status" data-scm-cut>
                {cut.text}
                {cut.offer.length > 0 && (
                  <>
                    {" "}
                    <button className="link" disabled={busy} onClick={() => void guarded(() => invoke("scm_ignore_heavy", { worktree: dir, folders: cut.offer }))}>
                      Add {cut.offer.join(", ")} to .gitignore
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="sb-list">
              {status && changeCount(status) === 0 && <div className="sb-hint">No changes{status.branch ? ` on ${status.branch}` : ""}.</div>}
              {status &&
                scmGroups(groupOrder).map((g) => (
                  <Fragment key={g}>{g === "conflicts" ? conflictCards() : g === "staged" ? section("Staged", status.staged, false) : g === "changes" ? section("Changes", status.changed, true) : section("Untracked", status.untracked, true)}</Fragment>
                ))}
              {status && filter && changeCount(status) > 0 && [status.staged, status.changed, status.untracked].every((rows) => filterRows(rows, filter).length === 0) && <div className="sb-hint">No changed file matches “{filter}”.</div>}
              {status && (status.submodulesCut ?? 0) > 0 && (
                <div className="sb-hint" data-submodules-cut>
                  {status.submodulesCut} more changed submodule{status.submodulesCut === 1 ? " was" : "s were"} left out of this list.
                </div>
              )}
            </div>
            {notesSection}
            <details className="scm-history" open={histOpen} onToggle={(e) => setHistOpen((e.target as HTMLDetailsElement).open)}>
              <summary>
                <span>History</span>
                <button
                  className="ib"
                  title="Refresh history"
                  onClick={(e) => {
                    e.preventDefault();
                    setHistTick((t) => t + 1);
                  }}
                >
                  <Refresh />
                </button>
              </summary>
              <div className="scm-hist-list" data-history>
                {history === null && <div className="sb-hint">Loading{"\u2026"}</div>}
                {history?.length === 0 && <div className="sb-hint">No commits yet.</div>}
                {history?.map((c, i) => (
                  <div key={c.hash}>
                    <div
                      className={`scm-commit-row${picked?.hash === c.hash ? " sel" : ""}`}
                      data-commit-row={c.short}
                      title={c.message}
                      role="button"
                      tabIndex={0}
                      aria-expanded={picked?.hash === c.hash}
                      onClick={() => pickCommit(c)}
                      onKeyDown={(e) => {
                        if ((e.key === "Enter" || e.key === " ") && !e.ctrlKey && !e.metaKey) {
                          e.preventDefault();
                          pickCommit(c);
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCtx({ x: Math.min(e.clientX, window.innerWidth - 240), y: Math.min(e.clientY, window.innerHeight - 130), commit: c });
                      }}
                    >
                      <GraphCell row={rows[i]} />
                      {c.outgoing && (
                        <span className="scm-io out" title="Not on the remote yet">
                          {"\u2191"}
                        </span>
                      )}
                      {c.incoming && (
                        <span className="scm-io in" title="On the remote, not here yet">
                          {"\u2193"}
                        </span>
                      )}
                      <span className="subj">{c.subject}</span>
                      {c.labels.map((l) => (
                        <span key={l.kind + l.name} className={`scm-ref k-${l.kind}`}>
                          {l.name}
                        </span>
                      ))}
                    </div>
                    {picked?.hash === c.hash && (
                      <div className="scm-commit-files">
                        {picked.files === null ? (
                          <div className="sb-hint">Loading{"\u2026"}</div>
                        ) : picked.files.length === 0 ? (
                          <div className="sb-hint">No files changed against the first parent.</div>
                        ) : (
                          picked.files.map((f) => (
                            <div key={f.path} className="scm-file">
                              <span className="st">{f.status}</span>
                              <span className="path">{f.from ? `${f.from} \u2192 ${f.path}` : f.path}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </details>
            {fileCtx && (
              <>
                <div className="menu-backdrop" onClick={() => setFileCtx(null)} aria-hidden="true" />
                <div className="menu" role="menu" aria-label="File actions" style={{ left: fileCtx.x, top: fileCtx.y }}>
                  <div className="menu-title">{fileCtx.path}</div>
                  {[
                    { id: "full", label: "Copy path", run: () => copy(fullPath(dir, fileCtx.path), "path") },
                    { id: "relative", label: "Copy relative path", run: () => copy(fileCtx.path, "relative path") },
                    { id: "open", label: "Open in its app", run: () => invoke("open_path", { path: fullPath(dir, fileCtx.path) }).catch((err) => setErrs((e) => ({ ...e, read: String(err) }))) },
                    { id: "reveal", label: "Show in file manager", run: () => invoke("scm_reveal", { worktree: dir, path: fileCtx.path }).catch((err) => setErrs((e) => ({ ...e, read: String(err) }))) },
                  ].map((item) => (
                    <button
                      key={item.id}
                      role="menuitem"
                      className="menu-item"
                      data-file-action={item.id}
                      onClick={() => {
                        setFileCtx(null);
                        void item.run();
                      }}
                    >
                      <span className="name">{item.label}</span>
                    </button>
                  ))}
                  <FileOpenWith dir={dir} path={fileCtx.path} done={() => setFileCtx(null)} onError={(m) => setErrs((e) => ({ ...e, read: m }))} />
                </div>
              </>
            )}
            {ctx && (
              <>
                <div className="menu-backdrop" onClick={() => setCtx(null)} aria-hidden="true" />
                <div className="menu" role="menu" aria-label="Commit actions" style={{ left: ctx.x, top: ctx.y }}>
                  <div className="menu-title hash">{ctx.commit.short}</div>
                  {[
                    { id: "hash", label: "Copy hash", run: () => copy(ctx.commit.hash, "commit hash") },
                    { id: "message", label: "Copy message", run: () => copy(ctx.commit.message, "commit message") },
                    ...(ghRepo ? [{ id: "open", label: "Open in browser", run: () => openInBrowser(commitUrl(ghRepo, ctx.commit.hash)!) }] : []),
                    { id: "explain", label: "Explain changes", run: () => explain(ctx.commit) },
                  ].map((item) => (
                    <button
                      key={item.id}
                      role="menuitem"
                      className="menu-item"
                      data-commit-action={item.id}
                      onClick={() => {
                        setCtx(null);
                        void item.run();
                      }}
                    >
                      <span className="name">{item.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <HandoffNote dir={dir} agents={agents} onHand={onHand} />
          </>
        )}
      </div>
      {discardingRows && plan && (
        <Ask
          title={plan.title}
          body={
            <>
              <p>{plan.body}</p>
              {discardingRows.rows.length > 1 && (
                <ul className="ask-list" aria-label="files affected">
                  {discardingRows.rows.map((r) => (
                    <li key={r.path}>{r.from ? `${r.from} → ${r.path}` : r.path}</li>
                  ))}
                </ul>
              )}
            </>
          }
          confirm={plan.button}
          onConfirm={confirmDiscard}
          onCancel={() => setDiscardingRows(null)}
        />
      )}
    </aside>
  );
}
