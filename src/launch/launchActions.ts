// The window's launch actions, moved out of App.tsx as they were (cycle 2, the App.tsx split): Start on a
// chooser (SESS-013), an agent started in a workspace (PROJ-038), resume (VIEW-085), setup and default tabs
// (PROJ-033/034), workspaces from an issue or a name, folder trust (SAFE-023) and a project-folder launch
// (SESS-004). A plain function the window calls each render, as the closures were made each render; what
// the window makes later in its render is read from `late` when an action runs (shell/windowLate.ts).
import type { Pane } from "../App";
import type { WindowState } from "../shell/windowStore";
import type { useSettingsPlumbing } from "../settings/useSettingsPlumbing";
import type { WindowLate } from "../shell/windowLate";
import { savedArgs } from "../chat/controls";
import { noteUse } from "../onboarding/features";
import { gatedSetup, settleSetup } from "../orchestration/workerSetup";
import { folderName, type Created, type WorkItem } from "../projects/model";
import { renameOnFirstPrompt } from "../projects/renameOnWork";
import { applySetting } from "../projects/settingWrite";
import { startFields } from "../projects/startArgs";
import { livePane } from "../sessions/livePane";
import type { Session } from "../sessions/model";
import { resumedFields, type ResumePlan } from "../sessions/resume";
import { saveChanged } from "../settings/saveChanged";
import { openDefaultTabs } from "../setup/DefaultTabs";
import { trustedSetup } from "../setup/TrustPrompt";
import { cellsOf, freeCell } from "../terminal/grid";
import type { StartLine } from "../terminal/tabName";
import { panesIn } from "../workspaces";
import { paneMark, type AgentInfo } from "./PlusMenu";
import { bulkRefusal, failureNote, settleSetups, setupMode, type NewPlace } from "./launchOrder";
import { LAST_LINEUP_KEY, TERMINAL, tooManySeats, seatFolder, lineupOf, openingPrompt, rulesBlock, seatArgs, type Lineup, type Seat } from "./seats";
import { invoke } from "@tauri-apps/api/core";

export function launchActions(s: WindowState, p: ReturnType<typeof useSettingsPlumbing>, late: WindowLate) {
  const {
    activeDir, agents, defaultId, focused, nextKey, panes, projects, setActiveDir, setAgentSel, setFocused, setLaunching, setNotice, setPage, setPanes,
    setRefresh, setScreen, setSettings, setSheet, setTabColors, setToast, settings, sheet
  } = s;
  const { settingsRef } = p;
  const lineupsOf = (s: Record<string, unknown>) => (s[LAST_LINEUP_KEY] ?? {}) as Record<string, Lineup>;
  const rememberLineup = (batch: number) => {
    const wait = late.pendingLineup.current[batch];
    if (!wait) return;
    delete late.pendingLineup.current[batch];
    void invoke<Record<string, unknown>>("get_settings")
      .then((s) => {
        // Row 794-c: laid over the latest settings (the disk copy lags writes in flight); disk lineups kept too.
        const { was, next } = applySetting(settingsRef, LAST_LINEUP_KEY, { ...lineupsOf(s), ...lineupsOf(settingsRef.current), [wait.pid]: wait.lineup });
        setSettings(next);
        return saveChanged(was, next);
      })
      .catch((err) => setNotice(String(err)));
  };

  // SESS-014: a chooser can copy only inside a Git project: its workspace, or (outside any
  // workspace) the registered projects.
  const inGitFor = (p: Pane) => p.cwd !== null || projects.length > 0;
  // Start replaces the chooser with one pane per seat (SESS-013). Every seat opens in the folder
  // the chooser is in (one folder per project, owner change 2026-11-05): no worktree and no second
  // copy is made, and the whole lineup lands in the same grid. A seat's first message is its role's
  // brief, the shared task and its own prompt (SESS-012); with two or more AI seats each also gets
  // the rules block and a handoff note made before it starts (SESS-025), in that folder and named
  // after the folder and its seat number.
  const startSeats = async (key: number, seats: Seat[]) => {
    const chooser = panes.find((p) => p.key === key) ?? (sheet?.key === key ? sheet : undefined);
    if (!chooser) return;
    const tooMany = tooManySeats(seats.length);
    if (tooMany) {
      setNotice(tooMany);
      return;
    }
    const inGrid = panes.some((p) => p.key === key);
    setLaunching(true);
    const kept: NewPlace[] = [];
    try {
      const picked = seats.map((s) => (s.agent === TERMINAL ? null : agents.find((a) => a.id === s.agent && a.installed) ?? null));
      const missing = seats.find((s, i) => s.agent !== TERMINAL && !picked[i]);
      if (missing) throw new Error(`${missing.agent} is not installed.`);
      const pid = late.projectOf(chooser.cwd) ?? projectFor(null);
      // SESS-013 / one folder (owner change 2026-11-05): every seat opens in the folder the
      // chooser is in, so all the sessions a person assigns land in the same grid. A chooser with
      // no folder (Home) falls back to the project folder.
      const root = projects.find((p) => p.id === pid)?.path ?? chooser.cwd;
      const place = seatFolder(chooser.cwd, root);
      if (picked.some(Boolean) && !place) throw new Error("Add a project first: an agent needs a project folder to work in.");
      // SESS-026 (T-150): a launch that makes new workspaces settles their setup before any agent
      // starts, and is refused before anything is made when the project asks about setup each time.
      const proj = projects.find((p) => p.id === pid);
      const makes = false;
      const repo = makes && proj ? await invoke<{ mode?: string; wait?: boolean }>("repo_setup_get", { path: proj.path }).catch(() => null) : null;
      const refused = bulkRefusal(proj?.name ?? "This project", setupMode(repo?.mode), makes);
      if (refused) throw new Error(refused);
      const madeNew: NewPlace[] = [];
      const setupTrouble: string[] = [];
      const places: { cwd: string | null; branch: string | null }[] = picked.map(() => ({ cwd: place, branch: chooser.branch }));
      const batch = key;
      await settleSetups(madeNew, setupMode(repo?.mode), repo?.wait === true, {
        line: (dir) => trustedSetup(dir),
        open: (dir, branch, line, where) => new Promise<void>((done) => late.startSetup(dir, branch, line, where, false, () => done())),
        say: (m) => setupTrouble.push(m),
      });
      for (const id of new Set(picked.flatMap((a) => (a ? [a.id] : [])))) await pretrust(id, picked.map((a, i) => (a?.id === id ? places[i].cwd : null)));
      // SESS-051: each agent's start line comes from the catalogue, prompt route included; a
      // refused line (Hermes past its limit) stops the whole Start before any pane is made.
      const side = picked.filter(Boolean).length >= 2;
      if (side && !place) throw new Error("Add a project first: agents side by side keep their handoff notes in it.");
      const task = chooser.task ?? "";
      const prompts: string[] = [];
      for (const [i, a] of picked.entries()) {
        const cwd = places[i].cwd ?? "";
        const note = a && side ? await invoke<string>("handoff_note_prepare", { root: place, name: `${folderName(cwd)}-seat-${i + 1}` }) : null;
        prompts.push(a ? openingPrompt(seats[i], task, note && rulesBlock(note)) : "");
      }
      const lines = await Promise.all(picked.map((a, i) => (a ? invoke<StartLine>("agent_start_line", { id: a.id, extra: seatArgs(seats[i]), prompt: prompts[i], picked: true }) : null)));
      const made: Pane[] = seats.map((s, i) => {
        const a = picked[i];
        const line = lines[i];
        const k = nextKey.current++;
        const title = s.title?.trim() || (s.role && s.role[0].toUpperCase() + s.role.slice(1)) || undefined;
        const { cwd, branch } = places[i];
        return a && line
          ? { key: k, cwd, branch, agent: paneMark(a, line), agentId: a.id, program: line.program ?? a.program, args: line.args, env: line.env, title, batch, typed: line.typed ?? undefined }
          : { key: k, cwd, branch, agent: "shell", program: null, args: [], title, batch };
      });
      if (pid && picked.some(Boolean)) late.pendingLineup.current[batch] = { pid, lineup: lineupOf(chooser.shape ?? "custom", "shared", seats) };
      // A grid chooser gives its place to the new panes; the New session page adds them (SESS-018).
      setPanes((ps) => (inGrid ? ps.flatMap((p) => (p.key === key ? made : [p])) : [...ps, ...made]));
      for (const n of madeNew) void openTabs(n.cwd, n.branch); // PROJ-034
      // VIEW-021: a preset started from the Agents rail stays the selected session once it runs.
      setAgentSel((sel) => (sel === key ? made[0].key : sel));
      if (!inGrid) {
        setSheet(null);
        setScreen("terminals");
        setPage(null);
      }
      setToast(made.length === 1 ? "Starting 1 session" : `Starting ${made.length} sessions`);
      setActiveDir(made[0].cwd);
      setFocused(made[0].key);
      setRefresh((n) => n + 1);
      setNotice(setupTrouble.length ? setupTrouble.join(" ") : null);
    } catch (err) {
      // A seat that failed leaves the earlier seats' new workspaces behind: refresh the sidebar so they show, and say so.
      if (kept.length) setRefresh((n) => n + 1);
      setNotice(failureNote(err, kept.length));
    } finally {
      setLaunching(false);
    }
  };

  // PROJ-038: the agent is the new workspace's first tab, started with its prompt; nothing else
  // opens there. Shown only when the sidebar says the user has not moved on.
  const startIn = async (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra: string[] = [], title?: string, dispatch?: string, run?: string): Promise<number | null> => {
    try {
      return await openIn(agent, dir, branch, prompt, show, extra, title, dispatch, run);
    } catch (err) {
      setNotice(String(err));
      return null;
    }
  };
  // The start itself; it throws when the start line or the folder's trust cannot be set up, so a
  // caller that reports its own failure (VIEW-069) can say what did not start.
  // T-172-e: `dispatch` (a worker start) goes into the session's environment, so Kolux can tell the
  // worker's own session from a tab the user opens in the same folder.
  // T-690: `run` (an automation run) goes in the same way, so its pane is credited to that run.
  const openIn = async (agent: AgentInfo, dir: string, branch: string | null, prompt: string, show: boolean, extra: string[] = [], title?: string, dispatch?: string, run?: string) => {
    await pretrust(agent.id, [dir]);
    // GIT-020 / PROJ-039 (T-107-d): the first task names a Kolux-suggested branch; the back end
    // leaves a hand-named workspace, a pushed branch or one with a pull request alone.
    void renameOnFirstPrompt(dir, prompt, settings);
    const line = await invoke<StartLine>("agent_start_line", { id: agent.id, extra, prompt });
    const key = nextKey.current++;
    const pane: Pane = { key, cwd: dir, branch, agent: paneMark(agent, line), agentId: agent.id, ...startFields(line, agent.program, dispatch, run), title };
    // TERM-007: an empty pane in that workspace takes the session; else it gets a cell of its own.
    setPanes((ps) => {
      const free = freeCell(cellsOf(panesIn(ps, dir)));
      return free ? ps.map((p) => (p === free ? pane : p)) : [...ps, pane];
    });
    if (show) {
      setActiveDir(dir);
      setFocused(key);
    }
    return key;
  };
  // VIEW-085 (T-169): a past session resumed in a new tab, in the folder the plan names (the session's
  // own worktree, else the one in front), on the agent's resume line from settings.
  // C28-R5-01: the pane records the id it was resumed with, so the live guard sees the session at once.
  const resumeIn = async (agentId: string, plan: ResumePlan, id?: string) => {
    const agent = agents.find((a) => a.id === agentId);
    const dir = plan.cwd ?? activeDir;
    if (!agent || dir === null) return setNotice(agent ? "Open a workspace first, then resume the session in it." : `${agentId} is not installed here, so its session cannot be resumed.`);
    try {
      await pretrust(agent.id, [dir]);
    } catch (err) {
      return setNotice(String(err));
    }
    const key = nextKey.current++;
    const line = plan.line;
    const pane: Pane = { key, cwd: dir, branch: panesIn(panes, dir)[0]?.branch ?? null, agent: paneMark(agent, line), agentId: agent.id, ...resumedFields(id), ...startFields(line, agent.program) };
    setPanes((ps) => {
      const free = freeCell(cellsOf(panesIn(ps, dir)));
      return free ? ps.map((p) => (p === free ? pane : p)) : [...ps, pane];
    });
    setActiveDir(dir);
    setFocused(key);
    return true;
  };
  // VIEW-088 (T-127-b): a session still running in a pane (sleeping or hidden ones too) focuses that pane instead of starting a copy.
  const resumeOrFocus = async (s: Session, plan: ResumePlan) => {
    let key = livePane(panes, s, null);
    if (key === null) {
      const d = await invoke<{ prompt: string | null }>("session_row_detail", { agent: s.agent, id: s.id, dir: s.dir }).catch(() => null);
      key = livePane(panes, s, d?.prompt ?? null);
    }
    const pane = key === null ? undefined : panes.find((p) => p.key === key);
    if (!pane) return resumeIn(s.agent, plan, s.id);
    if (pane.cwd !== null) setActiveDir(pane.cwd);
    setFocused(pane.key);
  };
  // PROJ-034: kolux.yaml's default tabs open beside the new workspace's first pane (its setup first, when it has one).
  const openTabs = (dir: string, branch: string | null) => {
    const root = projects.find((p) => p.id === late.projectOf(dir))?.path;
    return root ? openDefaultTabs(root, dir, branch, { nextKey, setPanes, setTabColors, say: setNotice }) : Promise.resolve();
  };
  // PROJ-033: a workspace made outside the composer runs its setup script in a background tab.
  const runSetup = (dir: string, branch: string | null) =>
    trustedSetup(dir)
      .then((line) => void (line ? late.cli.current.startSetup(dir, branch, line, "tab", false, () => openTabs(dir, branch)) : openTabs(dir, branch)))
      .catch((err) => setNotice(String(err)));
  // ORCH-017 (T-172-d): a worker start's setup: the trust question, one run in a background Setup
  // tab, and how it ended (its exit code, or null a second after the tab stopped without one)
  // reported to the worker-start waiting under `request`.
  const gateSetup = (request: string, dir: string, branch: string | null) =>
    gatedSetup(dir, (line) =>
      new Promise<number | null>((done) => {
        let key = -1;
        key = late.cli.current.startSetup(dir, branch, line, "tab", false, () => void setTimeout(() => late.setupExits.current[key]?.(null), 1000));
        late.setupExits.current[key] = (code) => {
          delete late.setupExits.current[key];
          done(code);
        };
      }),
    )
      .then((a) => settleSetup(request, a))
      .catch((err) => setNotice(String(err)));
  // PROJ-037: a workspace straight from an issue or pull request address, shown once made.
  const fromItem = (item: WorkItem) => {
    setToast(`Making a workspace from ${item.kind === "pull" ? "pull request" : "issue"} #${item.number}…`);
    invoke<Created>("workspace_from_item", { item })
      .then((made) => {
        setRefresh((n) => n + 1);
        late.cli.current.select(made.path, made.branch, true);
        void runSetup(made.path, made.branch);
      })
      .catch((err) => setNotice(String(err)));
  };
  // VIEW-042: a name typed in the palette is made at once in that project; the palette has closed.
  const fromName = (projectId: string, name: string) => {
    setToast(`Making the workspace ${name}…`);
    invoke<Created>("workspace_create", { projectId, name, base: null, branch: null, parent: null, ticket: null, issue: null })
      .then((made) => {
        noteUse("workspace-create");
        setRefresh((n) => n + 1);
        late.cli.current.select(made.path, made.branch, true);
        void runSetup(made.path, made.branch);
      })
      .catch((err) => setNotice(String(err)));
  };
  // Which project a launch belongs to: the one asked for, else the one that owns the focused
  // pane's folder, else the first in the list.
  // SAFE-023 / SAFE-024: every folder a launch will use (and its main repository) is marked
  // trusted in the agent's own configuration in one write before any agent process starts; best
  // effort, a failure never stops the launch.
  const pretrust = async (agent: string, dirs: (string | null)[]) => {
    const paths = [...new Set(dirs.flatMap((d) => (d === null ? [] : [d, projects.find((p) => p.id === late.projectOf(d))?.path])).filter((p): p is string => typeof p === "string"))];
    if (paths.length === 0) return;
    try {
      await invoke("trust_folders_cmd", { agent, paths });
    } catch (err) {
      console.warn(`trust: ${String(err)}`);
    }
  };
  // GIT-004: a refused commit can be handed to the default agent with the hook's own words.
  // GIT-019 (T-313-b): the fix recipe may name its own agent and extra start arguments.
  const fixWithAI = (output: string, launch?: { agent: string; extra: string[]; prompt: string }) => {
    const id = launch?.agent ?? defaultId;
    const a = agents.find((x) => x.id === id && x.installed);
    if (!a || activeDir === null) {
      setNotice(`The ${launch ? "recipe's" : "default"} agent (${id}) is not installed.`);
      return;
    }
    const prompt = launch?.prompt ?? `A git action in this workspace failed. Find the cause, fix it, and finish the action.\n\nGit said:\n${output}`;
    void startIn(a, activeDir, panesIn(panes, activeDir)[0]?.branch ?? null, prompt, true, launch?.extra ?? []);
  };
  const projectFor = (projectId: string | null): string | null => projectId ?? late.projectOf(panes.find((p) => p.key === focused)?.cwd ?? null) ?? projects[0]?.id ?? null;

  // SESS-004 (owner change 2026-11-05): the agent starts in the project folder. Kolux does not
  // make a worktree or any other copy of the project.
  const launch = async (agent: AgentInfo, projectId: string | null) => {
    const pid = projectFor(projectId);
    const proj = projects.find((p) => p.id === pid);
    if (!proj) {
      setNotice("Add a project first: an agent needs a project folder to work in.");
      return;
    }
    setLaunching(true);
    try {
      const branch = panesIn(panes, proj.path)[0]?.branch ?? null;
      // The agent's own start line (its options, permission mode and unpicked model default).
      if ((await startIn(agent, proj.path, branch, "", true, savedArgs(agent.id))) === null) return;
      setRefresh((n) => n + 1);
      setNotice(null);
    } catch (err) {
      setNotice(String(err));
    } finally {
      setLaunching(false);
    }
  };
  return {
    lineupsOf, rememberLineup, inGitFor, startSeats, startIn, openIn, resumeIn, resumeOrFocus, openTabs, runSetup, gateSetup, fromItem, fromName, pretrust,
    fixWithAI, projectFor, launch,
  };
}

export type LaunchActions = ReturnType<typeof launchActions>;
