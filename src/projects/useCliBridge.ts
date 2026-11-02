// The command line's requests to the window, moved out of App.tsx as they were (cycle 2, the App.tsx split):
// files to open once their worktree is in front (CLI-022, T-250-c), the handlers read through a ref so the
// one listener never goes stale (PROJ-077, CLI-026/027), and a run's own tab closing when its agent exits
// (AUTO-011). Called where they sat, so the window's hook order is unchanged.
import { openRunTab, paneOfTerminal, runTabEnded, touchRunTab, typedInRunTab } from "../automations/runTab";
import { missingFileToast } from "../editor/missingFile";
import { setupRequestOf } from "../orchestration/workerSetup";
import { sameDir } from "../workspaces";
import type { CliFile, CliWorkspace } from "./model";
import { startTail } from "./startArgs";
import { withHintedSession } from "../terminal/layout";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import type { WindowState } from "../shell/windowStore";
import type { PaneActions } from "../terminal/paneActions";
import type { LaunchActions } from "../launch/launchActions";
import type { WorkspaceActions } from "./useWorkspaces";
import type { WindowLate } from "../shell/windowLate";

export function useCliBridge({ activeDir, activeRef, agents, dropPane, focused, gateSetup, keyOfHandle, openDiff, openFile, pinned, ptys, removed, runPanes, runSetup, runTabs, select, setPanes, setRefresh, setupExits, splitPane, startIn, startSetup, termCreate, termRename, termSwitch }: Pick<WindowState, "activeDir" | "activeRef" | "agents" | "focused" | "pinned" | "ptys" | "runPanes" | "runTabs" | "setPanes" | "setRefresh"> & Pick<PaneActions, "dropPane" | "keyOfHandle" | "openDiff" | "openFile" | "splitPane" | "termCreate" | "termRename" | "termSwitch"> & Pick<LaunchActions, "gateSetup" | "runSetup" | "startIn"> & Pick<WorkspaceActions, "removed"> & Pick<WindowLate, "select" | "setupExits" | "startSetup">) {
  // CLI-022: `file open` / `file diff` / `file open-changed` name files of some worktree; the window goes
  // there first and opens the tabs once that worktree is the active one.
  const [cliFiles, setCliFiles] = useState<CliFile[]>([]);
  useEffect(() => {
    const ready = cliFiles.filter((f) => sameDir(f.worktree, activeDir));
    if (ready.length === 0) return;
    setCliFiles((q) => q.filter((f) => !ready.includes(f)));
    for (const f of ready) {
      void (async () => {
        let failed: string | null = null;
        try {
          // Row 65: a file that vanished since the command looked is refused with a reason, not reported opened.
          if (f.kind === "file-open" && (await missingFileToast(f.path, (ps) => invoke<unknown[]>("file_stamps", { paths: ps })))) failed = "the file is not there (or is outside this project)";
          else if (f.kind === "file-open") openFile(f.path);
          else openDiff(f.path, f.staged);
        } catch (err) {
          failed = String(err);
        }
        // T-250-c: tell the command line what became of the tab (a file that never gets here is unconfirmed).
        if (f.ack !== undefined) void invoke("cli_file_result", { id: f.ack, failed }).catch(() => undefined);
      })();
    }
  }, [cliFiles, activeDir]);
  // T-250-c: while this window runs, the command line waits for its answers about the files it asked to open.
  useEffect(() => {
    void invoke("cli_file_window", { listening: true }).catch(() => undefined);
    return () => void invoke("cli_file_window", { listening: false }).catch(() => undefined);
  }, []);
  const cli = useRef({ startIn, select, removed, termCreate, termSwitch, termRename, splitPane, keyOfHandle, startSetup, runSetup, gateSetup, dropPane: (_k: number) => {} });
  cli.current = { startIn, select, removed, termCreate, termSwitch, termRename, splitPane, keyOfHandle, startSetup, runSetup, gateSetup, dropPane: (k: number) => dropPane(k) };
  // AUTO-011 (T-085-g): a run's own agent tab shuts by itself, once, when that agent exits, unless the user
  // clicked (the pane's mouse-down above) or typed in it (a key inside the focused pane) or pinned it.
  const focusedNow = useRef(focused);
  focusedNow.current = focused;
  const pinnedNow = useRef(pinned);
  pinnedNow.current = pinned;
  useEffect(() => {
    const typed = (e: KeyboardEvent) => {
      const inside = e.target instanceof Element && e.target.closest(".pane.focused") !== null;
      if (typedInRunTab(runTabs.current, focusedNow.current, inside)) runTabs.current = touchRunTab(runTabs.current, focusedNow.current);
    };
    document.addEventListener("keydown", typed, true);
    const off = listen<{ id: number; code?: number | null; session?: string }>("terminal-exit", (e) => {
      const key = paneOfTerminal(ptys.current, e.payload.id);
      if (key === null) return;
      const printed = e.payload.session; // T-066-d: the id an id-only agent printed in its own resume hint; it wins over a listed guess (T-066-e), a hook's id is never replaced
      if (printed) setPanes((ps) => withHintedSession(ps, key, printed));
      setupExits.current[key]?.(e.payload.code ?? null);
      const ended = runTabEnded(runTabs.current, key, pinnedNow.current.has(key));
      runTabs.current = ended.tabs;
      if (ended.verdict === "close") cli.current.dropPane(key);
    });
    return () => {
      document.removeEventListener("keydown", typed, true);
      off.then((f) => f()).catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    const off = listen<CliWorkspace>("cli-workspace", (e) => {
      const p = e.payload;
      const c = cli.current;
      if (p.kind === "file-open" || p.kind === "file-diff") {
        if (!sameDir(p.worktree, activeRef.current)) c.select(p.worktree, p.branch);
        return setCliFiles((q) => [...q, p]);
      }
      if (p.kind === "terminal-create") return c.termCreate(p);
      if (p.kind === "terminal-split") return c.splitPane(c.keyOfHandle(p.handle), p.dir, p);
      if (p.kind === "terminal-rename") return c.termRename(p.handle, p.title);
      if (p.kind === "terminal-switch") return c.termSwitch(p.handle);
      if (p.kind === "terminal-close") return p.handles.map(c.keyOfHandle).filter(Number.isFinite).forEach(c.dropPane);
      setRefresh((n) => n + 1);
      if (p.kind === "repo" || p.kind === "changed") return;
      if (p.kind === "removed") {
        cli.current.removed(p.path);
        return;
      }
      // ORCH-016: a worker starts as a background tab in its worktree, named after its task.
      if (p.kind === "start") {
        const a = agents.find((x) => x.id === p.agent);
        if (a)
          void cli.current.startIn(a, p.path, p.branch, ...startTail(p)).then((key) => {
            // AUTO-013: an automation run remembers its pane, so View run opens that terminal.
            if (key !== null && p.runId) {
              runPanes.current[p.runId] = key;
              runTabs.current = openRunTab(runTabs.current, key, p.runId);
            }
          });
        return;
      }
      const a = p.agent ? agents.find((x) => x.id === p.agent) : undefined;
      // PROJ-033: a workspace made from the command line runs its setup script in a background tab
      // unless it was told to skip it. SESS-026 (T-150): the setup settles (asked, opened or said
      // why not) before its agent starts.
      // ORCH-017 (T-172-d): a worker-start's notice carries a request; worker-start waits for its answer.
      const request = setupRequestOf(p);
      const setup = p.setup === "skip" ? Promise.resolve() : request ? cli.current.gateSetup(request, p.worktree.path, p.worktree.branch) : cli.current.runSetup(p.worktree.path, p.worktree.branch);
      if (a) void setup.then(() => cli.current.startIn(a, p.worktree.path, p.worktree.branch, p.prompt, p.activate));
      else if (p.activate) cli.current.select(p.worktree.path, p.worktree.branch);
    });
    return () => {
      off.then((f) => f()).catch(() => undefined);
    };
  }, [agents]);
  return {
    cli,
  };
}

export type CliBridge = ReturnType<typeof useCliBridge>;
