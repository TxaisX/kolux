// What the window asks Git once at start, when the sidebar is not there to ask: every project and the worktrees each has,
// so a session in a worktree finds its project's one grid even with the sidebar closed. A failed answer adds nothing.
import { invoke } from "@tauri-apps/api/core";
import type { Project } from "./model";
import { scanProjects, type Scanned } from "./worktreeScan";

export async function scanGridOwners(): Promise<{ projects: Project[]; owner: Record<string, string> }> {
  const projects = await invoke<Project[]>("project_list");
  const owner: Record<string, string> = {};
  await scanProjects(
    projects,
    (p) => invoke<Scanned>("workspace_scan", { projectId: p.id }),
    (p, answer) => {
      if ("ok" in answer) for (const w of [...answer.ok.list, ...answer.ok.unseen]) owner[w.path] = p.id;
    },
  );
  return { projects, owner };
}
