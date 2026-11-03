// VIEW-059 (T-224-b): with no workspace the Explorer has nothing to list, so it offers a row that
// adds a project (the project list's own handler, projectDrop.add, takes the chosen folder).
// When the project list is not on screen there is no such handler: the row asks the window to show
// the list (a "kolux:show-projects" event) and, whether or not the list answers, adds the folder
// itself, so Add a project never ends in a dead-end message.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { FolderPlus } from "../chrome/icons";
import { projectDrop } from "./desktopDrops";

type Call = (cmd: string, args: { path: string }) => Promise<{ name?: string; path?: string }>;

/** Adds each folder as a project without the project list: a Git project, or (PROJ-005) a plain folder project when it is not inside a Git repository. Returns the names added. */
export async function addDirect(paths: string[], call: Call = invoke as Call): Promise<string[]> {
  const names: string[] = [];
  for (const path of paths) {
    try {
      names.push((await call("project_add", { path })).name ?? path);
    } catch (e) {
      if (!String(e).includes("not inside a Git repository")) throw e;
      names.push((await call("project_add_folder", { path })).name ?? path);
    }
  }
  return names;
}

export default function AddProjectRow() {
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const pick = async () => {
    setErr(null);
    setDone(null);
    try {
      const picked = await open({ directory: true, multiple: true, title: "Choose project folders" });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      if (!paths.length) return;
      if (projectDrop.add) return projectDrop.add(paths);
      window.dispatchEvent(new CustomEvent("kolux:show-projects"));
      const names = await addDirect(paths);
      setDone(`Added ${names.join(", ")}. Open the project list (the sidebar) and pick it to browse its files.`);
    } catch (e) {
      setErr(`The folder could not be added: ${String(e)}`);
    }
  };
  return (
    <div className="sb-hint add-project-row">
      <div>Open a workspace to browse its files.</div>
      <button className="menu-item" onClick={() => void pick()} title="Choose a folder to add as a project">
        <FolderPlus size={12} /> Add a project
      </button>
      {done && <div className="menu-hint" role="status">{done}</div>}
      {err && <div className="menu-hint" role="alert">{err}</div>}
    </div>
  );
}
