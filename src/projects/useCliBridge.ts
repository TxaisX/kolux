// The command line's requests to the window, moved out of App.tsx as they were (cycle 2, the App.tsx split):
// files to open once their worktree is in front (CLI-022, T-250-c), the handlers read through a ref so the
// one listener never goes stale (PROJ-077, CLI-026/027). Called where they sat, so the window's hook order is unchanged.
import { missingFileToast } from "../open/missingFile";
import { cliFileShown } from "./rows";
import type { CliFile, CliWorkspace } from "./model";
import { startTail } from "./startArgs";
import { withHintedSession } from "../terminal/layout";
import { invoke } from "@tauri-apps/api/core";
import { onTerminalExit } from "../terminal/outputBus";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import type { WindowState } from "../shell/windowStore";
import type { PaneActions } from "../terminal/paneActions";
import type { LaunchActions } from "../launch/launchActions";
import type { WorkspaceActions } from "./useWorkspaces";
import type { WindowLate } from "../shell/windowLate";

export function useCliBridge({ activeDir, activeRef, agents, dropPane, keyOfHandle, openFile, ptys, removed, select, setPanes, setRefresh, splitPane, settingsRef, startIn, termCreate, termRename, termSwitch }: { settingsRef: { current: Record<string, unknown> } } & Pick<WindowState, "activeDir" | "activeRef" | "agents" | "ptys" | "setPanes" | "setRefresh"> & Pick<PaneActions, "dropPane" | "keyOfHandle" | "openFile" | "splitPane" | "termCreate" | "termRename" | "termSwitch"> & Pick<LaunchActions, "startIn"> & Pick<WorkspaceActions, "removed"> & Pick<WindowLate, "select">) {
  // CLI-022: `file open` / `file diff` / `file open-changed` name files of some worktree; the window goes
  // there first and opens the tabs once that worktree is the active one.
  const [cliFiles, setCliFiles] = useState<CliFile[]>([]);
  useEffect(() => {
    // DT-C274: a team worktree's files wait for its team's grid, which select() shows instead of the worktree.
    const ready = cliFiles.filter((f) => cliFileShown(settingsRef.current, f.worktree, activeDir));
    if (ready.length === 0) return;
    setCliFiles((q) => q.filter((f) => !ready.includes(f)));
    for (const f of ready) {
      void (async () => {
        let failed: string | null = null;
        try {
          // Row 65: a file that vanished since the command looked is refused with a reason, not reported opened.
          if (f.kind === "file-open" && (await missingFileToast(f.path, (ps) => invoke<unknown[]>("file_stamps", { paths: ps })))) failed = "the file is not there (or is outside this project)";
          else if (f.kind === "file-open") openFile(f.path, undefined, undefined, undefined, f.worktree);
          else failed = "diffs are not shown in this version";
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
  const cli = useRef({ startIn, select, removed, termCreate, termSwitch, termRename, splitPane, keyOfHandle, dropPane: (_k: number) => {} });
  cli.current = { startIn, select, removed, termCreate, termSwitch, termRename, splitPane, keyOfHandle, dropPane: (k: number) => dropPane(k) };
  // T-066-d: a program's own resume hint names its session; it wins over a listed guess (T-066-e), a hook's id is never replaced.
  useEffect(() => {
    const off = onTerminalExit<{ id: number; code?: number | null; session?: string }>((e) => {
      const hit = Object.entries(ptys.current).find(([, t]) => t === e.payload.id);
      const printed = e.payload.session;
      if (hit && printed) setPanes((ps) => withHintedSession(ps, Number(hit[0]), printed));
    });
    return () => void off.then((f) => f()).catch(() => undefined);
  }, []);
  useEffect(() => {
    const off = listen<CliWorkspace>("cli-workspace", (e) => {
      const p = e.payload;
      const c = cli.current;
      if (p.kind === "file-open" || p.kind === "file-diff") {
        if (!cliFileShown(settingsRef.current, p.worktree, activeRef.current)) c.select(p.worktree, p.branch);
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
          void cli.current.startIn(a, p.path, p.branch, ...startTail(p));
        return;
      }
      const a = p.agent ? agents.find((x) => x.id === p.agent) : undefined;
      if (a) void cli.current.startIn(a, p.worktree.path, p.worktree.branch, p.prompt, p.activate);
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
