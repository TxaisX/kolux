// T-654 (DT-C89): Settings > Git & worktrees > Automatic pull requests. One default for every
// workspace ("on for GitHub repositories" is the recommended one) and, per workspace, "use the
// default", "on" or "off". Saved as `autoPr: { default, workspaces: { <folder>: true | false } }`;
// scm/autoPr.ts enabledFor() reads it back.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project, Worktree } from "../projects/model";
import { useSettings } from "./useSettings";

export type AutoPrDefault = "github" | "on" | "off";
export type Choice = "default" | "on" | "off";
export type AutoPrValue = { default: AutoPrDefault; workspaces: Record<string, boolean> };
export type Entry = { path: string; name: string };

export const DEFAULT_OPTIONS: { value: AutoPrDefault; label: string }[] = [
  { value: "github", label: "On for GitHub repositories (recommended)" },
  { value: "on", label: "On for every repository" },
  { value: "off", label: "Off" },
];
export const CHOICE_OPTIONS: { value: Choice; label: string }[] = [
  { value: "default", label: "Use default" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const norm = (d: string) => d.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const baseName = (d: string) => d.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || d;

/** The saved value as the page reads it: a missing or odd default is "github", and only true / false entries count. */
export function readAutoPr(settings: Record<string, unknown>): AutoPrValue {
  const raw = settings.autoPr && typeof settings.autoPr === "object" ? (settings.autoPr as { default?: unknown; workspaces?: unknown }) : {};
  const d = raw.default === "on" || raw.default === "off" ? raw.default : "github";
  const workspaces: Record<string, boolean> = {};
  if (raw.workspaces && typeof raw.workspaces === "object") for (const [k, v] of Object.entries(raw.workspaces)) if (typeof v === "boolean") workspaces[k] = v;
  return { default: d, workspaces };
}

/** The workspace's own choice, found with the folder compared like scm/autoPr.ts does. */
export function choiceOf(v: AutoPrValue, dir: string): Choice {
  const k = Object.keys(v.workspaces).find((x) => norm(x) === norm(dir));
  return k === undefined ? "default" : v.workspaces[k] ? "on" : "off";
}

/** The value after a workspace's choice changed: any older spelling of the folder is replaced, "default" removes the entry. */
export function withChoice(v: AutoPrValue, dir: string, c: Choice): AutoPrValue {
  const workspaces = Object.fromEntries(Object.entries(v.workspaces).filter(([k]) => norm(k) !== norm(dir)));
  if (c !== "default") workspaces[dir] = c === "on";
  return { ...v, workspaces };
}

/** Every workspace to list: the ones Kolux knows, then saved choices for folders it no longer lists, so they can be reset. */
export function entriesFor(known: Entry[], v: AutoPrValue): Entry[] {
  const seen = new Set(known.map((e) => norm(e.path)));
  const stale = Object.keys(v.workspaces).filter((k) => !seen.has(norm(k))).map((path) => ({ path, name: baseName(path) }));
  return [...known, ...stale];
}

type ViewProps = { value: AutoPrValue; entries: Entry[]; save: (next: AutoPrValue) => unknown };

export function AutoPrView({ value, entries, save }: ViewProps) {
  return (
    <section className="conn-card" data-section="auto-pr">
      <h2 className="conn-name">Automatic pull requests</h2>
      <p className="conn-detail">When an agent finishes a turn, Kolux commits on the workspace&apos;s branch, pushes it and opens or updates a draft pull request. It never commits on or pushes to the default branch, and it stops if it finds a likely secret or a file over 10 MB. A repository with no remote only gets commits.</p>
      <div className="look-select">
        <span>Default</span>
        <select aria-label="automatic pull requests default" className="field" value={value.default} onChange={(e) => void save({ ...value, default: e.target.value as AutoPrDefault })}>
          {DEFAULT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {entries.length > 0 && (
        <ul aria-label="automatic pull requests per workspace" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          {entries.map((e) => (
            <li key={e.path} className="look-select" style={{ minWidth: 0 }}>
              <span title={e.path} style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {e.name}
              </span>
              <select aria-label={`automatic pull requests for ${e.name}`} className="field" style={{ flex: "none" }} value={choiceOf(value, e.path)} onChange={(ev) => void save(withChoice(value, e.path, ev.target.value as Choice))}>
                {CHOICE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Every project's workspaces (its main folder included), by the name the sidebar gives them. */
async function loadEntries(): Promise<Entry[]> {
  const projects = await invoke<Project[]>("project_list");
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const p of projects) {
    const list = await invoke<Worktree[]>("workspace_list", { projectId: p.id }).catch(() => [] as Worktree[]);
    for (const w of list) {
      if (seen.has(norm(w.path))) continue;
      seen.add(norm(w.path));
      out.push({ path: w.path, name: w.name?.trim() || (w.isMain ? p.displayName?.trim() || p.name : w.branch || baseName(w.path)) });
    }
  }
  return out;
}

export default function AutoPrSettings() {
  const { settings, save } = useSettings();
  const [known, setKnown] = useState<Entry[]>([]);
  useEffect(() => {
    let live = true;
    loadEntries().then((e) => live && setKnown(e), () => {});
    return () => {
      live = false;
    };
  }, []);
  if (!settings) return null;
  const value = readAutoPr(settings);
  return <AutoPrView value={value} entries={entriesFor(known, value)} save={(next) => save({ autoPr: next })} />;
}
