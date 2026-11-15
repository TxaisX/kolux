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
import { folderName, projectLabel, type Created, type Project, type WorkItem, type Worktree } from "../projects/model";
import { renameOnFirstPrompt } from "../projects/renameOnWork";
import { applySetting } from "../projects/settingWrite";
import { startFields } from "../projects/startArgs";
import { livePane } from "../sessions/livePane";
import type { Session } from "../sessions/model";
import { resumedFields, type ResumePlan } from "../sessions/resume";
import { saveChanged } from "../settings/saveChanged";
import { openDefaultTabs } from "../setup/DefaultTabs";
import { trustedSetup } from "../setup/TrustPrompt";
import { cellsOf, freeCell, groupOf, MAX_PANES } from "../terminal/grid";
import type { StartLine } from "../terminal/tabName";
import { panesIn, sameDir, viewOf } from "../workspaces";
import { startDirOf } from "../projects/worktreeGrid";
import { addTeamFolders, mergedTeamFolders, TEAM_WORKTREES_SETTING, teamViewOf } from "../projects/rows";
import { paneMark, type AgentInfo } from "./PlusMenu";
import { bulkRefusal, failureNote, settleSetups, setupMode, type NewPlace } from "./launchOrder";
import { LAST_LINEUP_KEY, TERMINAL, tooManySeats, seatFolder, defaultCopies, lineupOf, openingPrompt, rulesBlock, seatArgs, type Lineup, type Seat } from "./seats";
import { singleFolder } from "../projects/singleFolder";
import { acrossNote, LAST_START_KEY, startEach, type StartSheet } from "./startForm";
import { invoke } from "@tauri-apps/api/core";

export function launchActions(s: WindowState, p: ReturnType<typeof useSettingsPlumbing>, late: WindowLate) {
  const {
    workDir, agents, defaultId, focused, nextKey, panes, projects, setActiveDir, setAgentSel, setFocused, setLaunching, setNotice, setPage, setPanes,
    setRefresh, setScreen, setSettings, setSheet, setTabColors, setToast, settings, sheet
  } = s;
  const { settingsRef } = p;
  const lineupsOf = (s: Record<string, unknown>) => (s[LAST_LINEUP_KEY] ?? {}) as Record<string, Lineup>;
  // DT-C274: the worktrees an own-folder team launch made and the grid they are shown in, kept so the sidebar leaves
  // them out and anything opened in one lands in that grid (projects/rows.ts). Row 794-c: laid over the disk copy
  // and the latest settings, as rememberLineup is, so a record another window wrote meanwhile is kept.
  const rememberTeamFolders = (add: { path: string; view: string }[]) => {
    const record = (disk: unknown) => {
      const { was, next } = applySetting(settingsRef, TEAM_WORKTREES_SETTING, addTeamFolders(mergedTeamFolders(disk, settingsRef.current[TEAM_WORKTREES_SETTING]), add));
      setSettings(next);
      return saveChanged(was, next);
    };
    // The record lands at once (the sidebar hides the worktrees as the team appears), then again over the disk copy.
    record(undefined).catch((err) => setNotice(String(err)));
    void invoke<Record<string, unknown>>("get_settings")
      .then((disk) => record(disk?.[TEAM_WORKTREES_SETTING]))
      .catch((err) => setNotice(String(err)));
  };
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
  // Start form C: `given` is the chooser to start from when it is neither in the grid nor the open sheet (a second
  // ticked folder). True once the sessions have landed. `say` takes the closing line in place of the notice bar, so a
  // launch across folders can say every folder's outcome in one line (wave 2, item 2).
  // Job 13 F3: `o.form` is the form that started this launch (only that one closes); `o.quiet` lands the sessions
  // without changing the screen, the page, the folder in front or the focus (a later folder of a Start across folders).
  const startSeats = async (key: number, seats: Seat[], given?: Pane, say: (note: string | null) => void = setNotice, o: { form?: number; quiet?: boolean } = {}): Promise<boolean> => {
    const chooser = given ?? panes.find((p) => p.key === key) ?? (sheet?.key === key ? sheet : undefined);
    if (!chooser) return false;
    const tooMany = tooManySeats(seats.length);
    if (tooMany) {
      say(tooMany);
      return false;
    }
    const inGrid = panes.some((p) => p.key === key);
    setLaunching(true);
    const kept: NewPlace[] = [];
    // T-780 follow-up: the "Starting n sessions" toast would hide a trust line, so the Start gathers
    // its lines for the notice bar until it knows how it ended. Only a line actually shown counts as
    // said; one that arrives after the end is a toast of its own.
    const trustLines: [string, () => void][] = [];
    let seatsSettled = false;
    const seatTell: TrustTell = (line, shown) => {
      if (!seatsSettled) return void trustLines.push([line, shown]);
      setToast(line);
      shown();
    };
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
      // DT-C250: with "Own folder for each agent" on and the chooser set to own folders, every AI seat gets a
      // fresh worktree of its own (SESS-014, SESS-023), made one after another so no two pick one name. A plain
      // terminal seat stays in the chooser's folder. Off (the default), nothing is made.
      const separate = !singleFolder() && inGitFor(chooser) && (chooser.copies ?? defaultCopies(seats.length, inGitFor(chooser))) === "separate";
      const makes = separate && picked.some(Boolean);
      // DT-C274: AI seats in worktrees of their own are a team: one grid in the chooser's folder, the worktrees
      // recorded. Txais (2026-11-12): one AI seat counts too, so its agent shows as a session under the folder and
      // its worktree never gets a sidebar row or a grid of its own.
      const team = makes;
      if (makes && !pid) throw new Error("Add a project first: an agent needs a project folder to work in.");
      // SESS-008: the seats that land in the chooser's own grid, with the cells already there (the chooser's own
      // cell gives its place), stay within MAX_PANES, as a chooser or a split does. DT-C274: an own-folder team
      // lands there whole too (each agent runs in its worktree, all are shown in the chooser's grid).
      const landing = makes && !team ? picked.filter((a) => a === null).length : seats.length;
      if (cellsOf(panesIn(panes.filter((p) => p.key !== key), place)).length + landing > MAX_PANES) {
        say(`A workspace holds up to ${MAX_PANES} panes.`);
        return false;
      }
      const repo = makes && proj ? await invoke<{ mode?: string; wait?: boolean }>("repo_setup_get", { path: proj.path }).catch(() => null) : null;
      const refused = bulkRefusal(proj?.name ?? "This project", setupMode(repo?.mode), makes);
      if (refused) throw new Error(refused);
      const madeNew: NewPlace[] = [];
      const setupTrouble: string[] = [];
      const places: { cwd: string | null; branch: string | null }[] = [];
      for (const a of picked) {
        if (a === null || !makes) {
          places.push({ cwd: place, branch: chooser.branch });
          continue;
        }
        const wt = await invoke<Worktree>("workspace_create_fresh", { projectId: pid });
        // DT-C274: a team worktree is recorded the moment it is made, so its row never shows in the sidebar (not even
        // while its setup runs). A launch that then fails or is cancelled leaves the record; a stranded one is shown
        // as a plain workspace (select) and pruned once the folder is gone.
        if (team && place) rememberTeamFolders([{ path: wt.path, view: place }]);
        madeNew.push({ cwd: wt.path, branch: wt.branch });
        kept.push({ cwd: wt.path, branch: wt.branch });
        places.push({ cwd: wt.path, branch: wt.branch });
      }
      const batch = key;
      // The chooser's cell, where a team worktree's Setup tab waits until its agent lands.
      const chooserGroup = inGrid ? groupOf(chooser) : undefined;
      await settleSetups(madeNew, setupMode(repo?.mode), repo?.wait === true, {
        line: (dir) => trustedSetup(dir),
        // DT-C274: a team worktree's Setup tab is shown in the team's grid (a tab of the chooser's cell until its agent lands).
        open: (dir, branch, line, where) => new Promise<void>((done) => late.startSetup(dir, branch, line, where, false, () => done(), team ? place : undefined, chooserGroup)),
        say: (m) => setupTrouble.push(m),
      });
      for (const id of new Set(picked.flatMap((a) => (a ? [a.id] : [])))) await pretrust(id, picked.map((a, i) => (a?.id === id ? places[i].cwd : null)), seatTell);
      // SESS-051: each agent's start line comes from the catalogue, prompt route included; a
      // refused line (Hermes past its limit) stops the whole Start before any pane is made.
      const side = picked.filter(Boolean).length >= 2;
      if (side && !place) throw new Error("Add a project first: agents side by side keep their handoff notes in it.");
      const task = chooser.task ?? "";
      // A seat in its own folder is named after that folder; seats sharing one are told apart by number. The notes
      // are made together (the names differ), in seat order; the first one refused stops the Start as before.
      const notes = await Promise.all(
        picked.map((a, i) => {
          const cwd = places[i].cwd ?? "";
          return a && side ? invoke<string>("handoff_note_prepare", { root: place, name: makes ? folderName(cwd) : `${folderName(cwd)}-seat-${i + 1}` }) : null;
        }),
      );
      const prompts = picked.map((a, i) => (a ? openingPrompt(seats[i], task, notes[i] && rulesBlock(notes[i] as string, makes)) : ""));
      const lines = await Promise.all(picked.map((a, i) => (a ? invoke<StartLine>("agent_start_line", { id: a.id, extra: seatArgs(seats[i]), prompt: prompts[i], picked: true }) : null)));
      const made: Pane[] = seats.map((s, i) => {
        const a = picked[i];
        const line = lines[i];
        const k = nextKey.current++;
        const title = s.title?.trim() || (s.role && s.role[0].toUpperCase() + s.role.slice(1)) || undefined;
        const { cwd, branch } = places[i];
        // DT-C274: an own-folder team is one grid: every pane of the lineup is shown in the chooser's folder. An
        // untitled agent there is called after its worktree by tabName (apartName), below its session's own name.
        const shown = team ? { view: place } : {};
        return a && line
          ? { key: k, cwd, branch, ...shown, agent: paneMark(a, line), agentId: a.id, program: line.program ?? a.program, args: line.args, env: line.env, title, batch, typed: line.typed ?? undefined }
          : { key: k, cwd, branch, ...shown, agent: "shell", program: null, args: [], title, batch };
      });
      // A grid chooser closed while the Start was under way takes the launch with it: nothing lands and the focus
      // stays where the user put it (it would name a pane that is not there).
      if (inGrid && !late.panesRef.current.some((p) => p.key === key)) {
        seatsSettled = true;
        if (kept.length) setRefresh((n) => n + 1);
        return false;
      }
      if (pid && picked.some(Boolean)) late.pendingLineup.current[batch] = { pid, lineup: lineupOf(chooser.shape ?? "custom", makes ? "separate" : "shared", seats) };
      // A grid chooser gives its place to the new panes; the New session page adds them (SESS-018). DT-C274: a team
      // worktree's Setup tab, waiting in the chooser's cell, joins its agent's cell.
      setPanes((ps) => {
        const landed = inGrid ? ps.flatMap((p) => (p.key === key ? made : [p])) : [...ps, ...made];
        if (!team) return landed;
        const agentIn = (p: Pane) => made.find((m) => m.agentId && sameDir(m.cwd, p.cwd));
        return landed.map((p) => {
          const owner = p.setupScript && p.view === place ? agentIn(p) : undefined;
          return owner ? { ...p, group: groupOf(owner) } : p;
        });
      });
      for (const n of madeNew) void openTabs(n.cwd, n.branch, team ? place : undefined); // PROJ-034, beside its agent in the team grid (DT-C274)
      // VIEW-021: a preset started from the Agents rail stays the selected session once it runs.
      setAgentSel((sel) => (sel === key ? made[0].key : sel));
      if (!inGrid) {
        const form = o.form ?? key;
        setSheet((s) => (s?.key === form ? null : s));
        if (!o.quiet) {
          setScreen("terminals");
          setPage(null);
        }
      }
      setToast(made.length === 1 ? "Starting 1 session" : `Starting ${made.length} sessions`);
      if (!o.quiet) {
        setActiveDir(team ? place : made[0].cwd);
        setFocused(made[0].key);
      }
      setRefresh((n) => n + 1);
      seatsSettled = true;
      const said = [...setupTrouble, ...trustLines.map(([line]) => line)];
      say(said.length ? said.join(" ") : null);
      for (const [, shown] of trustLines) shown();
      return true;
    } catch (err) {
      // Trust lines gathered so far were never shown: they stay unsaid, so the next launch says them.
      seatsSettled = true;
      // A seat that failed leaves the earlier seats' new workspaces behind: refresh the sidebar so they show, and say so.
      if (kept.length) setRefresh((n) => n + 1);
      say(failureNote(err, kept.length));
      return false;
    } finally {
      setLaunching(false);
    }
  };

  // Start form C: Start launches the same lineup in every ticked folder, each in that folder's own grid, through
  // startSeats once per folder (one launch path). A folder that is refused or fails does not stop the rest; one line
  // then says how many started and which folders need the user, and why (wave 2, item 2). The form closes once any
  // folder has started (startSeats closes it), so it stays open only when nothing started. The folders and the count
  // are kept for the next form (rule F).
  const startAcross = async (from: StartSheet, seats: Seat[]) => {
    const ids = (from.folders ?? []).filter((id) => projects.some((p) => p.id === id));
    if (ids.length === 0) return void (await startSeats(from.key, seats));
    const tooMany = tooManySeats(seats.length * ids.length);
    if (tooMany) return setNotice(tooMany);
    p.saveSetting(LAST_START_KEY, { folders: ids, count: seats.length });
    const said: string[] = [];
    let landed = false; // the first folder that starts brings its grid to the front; later ones land quietly (job 13 F3)
    const results = await startEach(
      ids.map((id) => projects.find((x) => x.id === id)!),
      seats.length,
      async (proj, n) => {
        const here = late.projectOf(from.cwd) === proj.id;
        const chooser: Pane = { ...from, key: n === 0 ? from.key : nextKey.current++, cwd: here ? from.cwd : proj.path, branch: here ? from.branch : null };
        const got: { note: string | null } = { note: null };
        const ok = await startSeats(chooser.key, seats, chooser, (m) => void (got.note = m), { form: from.key, quiet: landed });
        if (!ok) return got.note ?? "It did not start. Try again.";
        landed = true;
        if (got.note) said.push(got.note);
        return null;
      },
    );
    const line = [acrossNote(results), ...said].filter(Boolean).join(" ");
    setNotice(line || null);
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
    const view = teamViewOf(settingsRef.current, dir); // DT-C274: a team worktree's panes are shown in its team's grid
    const at = view === undefined ? dir : view;
    const pane: Pane = { key, cwd: dir, ...(view === undefined ? {} : { view }), branch, agent: paneMark(agent, line), agentId: agent.id, ...startFields(line, agent.program, dispatch, run), title };
    // TERM-007: an empty pane in that workspace takes the session; else it gets a cell of its own.
    setPanes((ps) => {
      const free = freeCell(cellsOf(panesIn(ps, at)));
      return free ? ps.map((p) => (p === free ? pane : p)) : [...ps, pane];
    });
    if (show) {
      setActiveDir(at);
      setFocused(key);
    }
    return key;
  };
  // VIEW-085 (T-169): a past session resumed in a new tab, in the folder the plan names (the session's
  // own worktree, else the one in front), on the agent's resume line from settings.
  // C28-R5-01: the pane records the id it was resumed with, so the live guard sees the session at once.
  const resumeIn = async (agentId: string, plan: ResumePlan, id?: string) => {
    const agent = agents.find((a) => a.id === agentId);
    const dir = plan.cwd ?? workDir;
    if (!agent || dir === null) return setNotice(agent ? "Open a workspace first, then resume the session in it." : `${agentId} is not installed here, so its session cannot be resumed.`);
    try {
      await pretrust(agent.id, [dir]);
    } catch (err) {
      return setNotice(String(err));
    }
    const key = nextKey.current++;
    const line = plan.line;
    // DT-C274: a session of a team worktree resumes in its team's grid; the branch is the one a pane running there has.
    const view = teamViewOf(settingsRef.current, dir);
    const at = view === undefined ? dir : view;
    const pane: Pane = { key, cwd: dir, ...(view === undefined ? {} : { view }), branch: panes.find((p) => sameDir(p.cwd, dir))?.branch ?? null, agent: paneMark(agent, line), agentId: agent.id, ...resumedFields(id), ...startFields(line, agent.program) };
    setPanes((ps) => {
      const free = freeCell(cellsOf(panesIn(ps, at)));
      return free ? ps.map((p) => (p === free ? pane : p)) : [...ps, pane];
    });
    setActiveDir(at);
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
    const at = viewOf(pane); // DT-C274: the grid the pane is shown in
    if (at !== null) setActiveDir(at);
    setFocused(pane.key);
  };
  // PROJ-034: kolux.yaml's default tabs open beside the new workspace's first pane (its setup first, when it has one).
  // DT-C274: `view`, the grid a team worktree is shown in; its tabs join its agent's cell there.
  const openTabs = (dir: string, branch: string | null, view?: string | null) => {
    const root = projects.find((p) => p.id === late.projectOf(dir))?.path;
    return root ? openDefaultTabs(root, dir, branch, { nextKey, setPanes, setTabColors, say: setNotice }, view) : Promise.resolve();
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
  // effort, a failure never stops the launch. T-780 follow-up: a folder left unmarked is said once in
  // the window (the toast, or `tell` for a caller that shows its own notice), never by focus or a window.
  const toastTell: TrustTell = (line, shown) => {
    setToast(line);
    shown();
  };
  const pretrust = async (agent: string, dirs: (string | null)[], tell: TrustTell = toastTell) => {
    const paths = [...new Set(dirs.flatMap((d) => (d === null ? [] : [d, projects.find((p) => p.id === late.projectOf(d))?.path])).filter((p): p is string => typeof p === "string"))];
    if (paths.length === 0) return;
    try {
      await invoke("trust_folders_cmd", { agent, paths });
    } catch (err) {
      const reason = String(err);
      console.warn(`trust: ${reason}`);
      const told = `${agent}\n${paths.join("\n")}\n${reason}`;
      if (toldTrust.has(told)) return;
      // Not awaited: the lookups below only shape the line, and the agent's start never waits on them.
      void trustLine(agent, reason, dirs).then((line) => {
        if (line !== null && !toldTrust.has(told)) tell(line, () => toldTrust.add(told));
      });
    }
  };
  // The line for a refused pre-trust. "no folders to trust" means nothing Kolux made was in the
  // batch: a workspace holding a pull request is left out on purpose, so that is said; the
  // project's own folder keeps the agent's prompt without a word. Claude's trust goes into the
  // active managed account's file when one is in use (trust.rs `trust_for_launch`), so the line
  // names that account; Codex has one file, so its line names Codex alone.
  const trustLine = async (agent: string, reason: string, dirs: (string | null)[]): Promise<string | null> => {
    const name = agents.find((a) => a.id === agent)?.name ?? agent;
    if (reason === NOTHING_TO_TRUST) {
      const own = dirs.filter((d): d is string => d !== null);
      const ds = await Promise.all(own.map((path) => invoke<{ item: string | null } | null>("workspace_details_get", { path }).catch(() => null)));
      return ds.some((d) => holdsPullRequest(d?.item)) ? trustNote(name, PR_REASON, projects) : null;
    }
    const managed =
      agent === "claude" &&
      reason.startsWith(MAIN_REASON) &&
      (await invoke<{ active: string | null; keyMode: boolean }>("claude_accounts").then((v) => v.active !== null && !v.keyMode, () => false));
    return trustNote(name, reason, projects, managed);
  };
  // GIT-004: a refused commit can be handed to the default agent with the hook's own words.
  // GIT-019 (T-313-b): the fix recipe may name its own agent and extra start arguments.
  const fixWithAI = (output: string, launch?: { agent: string; extra: string[]; prompt: string }) => {
    const id = launch?.agent ?? defaultId;
    const a = agents.find((x) => x.id === id && x.installed);
    if (!a || workDir === null) {
      setNotice(`The ${launch ? "recipe's" : "default"} agent (${id}) is not installed.`);
      return;
    }
    const prompt = launch?.prompt ?? `A git action in this workspace failed. Find the cause, fix it, and finish the action.\n\nGit said:\n${output}`;
    void startIn(a, workDir, panes.find((p) => sameDir(p.cwd, workDir))?.branch ?? null, prompt, true, launch?.extra ?? []);
  };
  const projectFor = (projectId: string | null): string | null => projectId ?? late.projectOf(panes.find((p) => p.key === focused)?.cwd ?? null) ?? projects[0]?.id ?? null;

  // SESS-004 (owner change 2026-11-05): the agent starts in the project folder. Kolux does not
  // make a worktree or any other copy of the project.
  // DT-C250: with "Own folder for each agent" on, it starts in a fresh worktree of its own instead (SESS-023).
  const launch = async (agent: AgentInfo, projectId: string | null) => {
    const pid = projectFor(projectId);
    const proj = projects.find((p) => p.id === pid);
    if (!proj) {
      setNotice("Add a project first: an agent needs a project folder to work in.");
      return;
    }
    setLaunching(true);
    try {
      // The agent's own start line (its options, permission mode and unpicked model default).
      if (singleFolder()) {
        const dir = startDirOf(proj.path) ?? proj.path; // the worktree picked in a pane-header menu, else the project folder
        const branch = panes.find((p) => sameDir(p.cwd, dir))?.branch ?? null;
        if ((await startIn(agent, dir, branch, "", true, savedArgs(agent.id))) === null) return;
      } else {
        const wt = await invoke<Worktree>("workspace_create_fresh", { projectId: pid });
        // Txais (2026-11-12): the agent's worktree is recorded with the project folder as its grid, like a team's, so its pane
        // shows in the folder's grid as a session and the worktree gets no row or grid of its own.
        rememberTeamFolders([{ path: wt.path, view: proj.path }]);
        if ((await startIn(agent, wt.path, wt.branch, "", true, savedArgs(agent.id))) === null) return;
      }
      setRefresh((n) => n + 1);
      setNotice(null);
    } catch (err) {
      setNotice(String(err));
    } finally {
      setLaunching(false);
    }
  };
  return {
    lineupsOf, rememberLineup, inGitFor, startSeats, startAcross, startIn, openIn, resumeIn, resumeOrFocus, openTabs, runSetup, gateSetup, fromItem, fromName, pretrust,
    fixWithAI, projectFor, launch,
  };
}

export type LaunchActions = ReturnType<typeof launchActions>;

/** The back end's answer when a launch's batch held no worktree Kolux made (trust_folders_cmd). */
const NOTHING_TO_TRUST = "no folders to trust";
/** The reason the back end gives for a pull request's worktree (trust.rs `not_pre_trusted_why`). */
const PR_REASON = "not trusted: this worktree holds a pull request's branch, so the agent asks itself";
/** How trust.rs begins the reason for a worktree whose main checkout the user has not trusted. */
const MAIN_REASON = "not trusted: the main checkout ";
/** Each trust line is shown once per window session for an agent and its folders, not on every launch there. */
const toldTrust = new Set<string>();
/** Shows a trust line; `shown` marks it said, called only once the line is really on screen. */
type TrustTell = (line: string, shown: () => void) => void;

/** Whether a workspace's linked item (the details form's link) is a pull request address. */
export function holdsPullRequest(item: string | null | undefined): boolean {
  return typeof item === "string" && /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/\d+\/?$/i.test(item.trim());
}

const samePath = (a: string, b: string) => {
  const n = (p: string) => p.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
};

/**
 * T-780 follow-up: the window's plain line for a folder Kolux did not mark trusted for `agentName`,
 * from the reason the back end gave (trust.rs). The agent then asks its own trust question, unless
 * the user already answered it in that folder, hence "may". Null when there is nothing to say.
 * `managedAccount`: the trust is read from a managed account's own file, so the line names that account.
 */
export function trustNote(agentName: string, reason: string, projects: Pick<Project, "path" | "name" | "displayName">[], managedAccount = false): string | null {
  const lead = `${agentName} may ask whether to trust this workspace`;
  if (reason === NOTHING_TO_TRUST) return null;
  if (reason === PR_REASON) return `${lead} because it holds a pull request.`;
  const main = /^not trusted: the main checkout (.+) is not trusted for \S+ yet, so its worktree .+ keeps the agent's own prompt$/s.exec(reason);
  if (main) {
    const p = projects.find((x) => samePath(x.path, main[1]));
    return `${lead}: you haven't trusted ${p ? projectLabel(p) : folderName(main[1])} in ${managedAccount ? `this ${agentName} account` : agentName} yet.`;
  }
  // trust.rs says "is not a git worktree" for any folder git cannot place in a repository with a checkout.
  const loose = /^not trusted: (.+) is not a git worktree, so it keeps the agent's own prompt$/s.exec(reason);
  if (loose) return `${lead}: ${folderName(loose[1])} isn't inside a git repository Kolux can check.`;
  return `${lead}: Kolux couldn't mark it trusted (${reason.replace(/^not trusted: /, "")}).`;
}
