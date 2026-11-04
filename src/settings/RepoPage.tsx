// SET-033: one repository's page in Settings: its display name, base branch and workspaces folder
// (each showing the inherited value until the user overrides it), and whether workspaces made outside
// Kolux show. Drafts save only when changed.
import { useEffect, useRef, useState } from "react";
import { clearLeft, failLeft, keepLeft, takeLeft, useLeaveSave, type Left } from "./leave";
import { invoke } from "@tauri-apps/api/core";
import { projectLabel, type Project } from "../projects/model";
import RepoSetupSection from "./RepoSetup";

/** What a field's draft saves: null when it says what is saved already (viewing writes nothing). */
export function draftSave(saved: string | null | undefined, draft: string): string | null {
  const next = draft.trim();
  return next === (saved ?? "").trim() ? null : next;
}

type Field = "base" | "workspacesDir" | "displayName";

/** C20-R4-01: what a field's leave save is kept under, so the page can take it back on its next mount. */
const keyOf = (id: string, field: Field) => `repo:${id}:${field}`;

const FIELD_LABELS: Record<Field, string> = { displayName: "Display name", base: "New workspaces start from", workspacesDir: "Workspaces folder" };

/** The repository's own choice about workspaces made outside Kolux (visibility source "other"). */
export type Outside = { global: boolean; own: boolean | null };
export type OutsideChoice = "global" | "show" | "hide";

export function outsideChoice(o: Outside): OutsideChoice {
  return o.own === null ? "global" : o.own ? "show" : "hide";
}

/** What a choice saves: null clears the repository's own choice, so the global one applies again. */
export function outsideSave(choice: OutsideChoice): boolean | null {
  return choice === "global" ? null : choice === "show";
}

function OutsideField({ outside, onChoose }: { outside: Outside; onChoose: (own: boolean | null) => void }) {
  return (
    <label className="look-select">
      <span>Workspaces made outside Kolux</span>
      <select aria-label="Workspaces made outside Kolux" className="field" value={outsideChoice(outside)} onChange={(e) => onChoose(outsideSave(e.target.value as OutsideChoice))}>
        <option value="global">{`Use the global choice (${outside.global ? "shown" : "hidden"})`}</option>
        <option value="show">Show them</option>
        <option value="hide">Hide them</option>
      </select>
    </label>
  );
}

function DraftField({ label, saved, inherited, start, onSave }: { label: string; saved: string | null | undefined; inherited: string; start?: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(start ?? saved ?? "");
  // C20-R4-01: a draft taken back from a failed leave save is what the box must show. The reset that
  // follows `saved` runs on mount too, so it skips its first run when a draft was restored; otherwise
  // it would put the stored value back over the text the alert says is in the box.
  const restored = useRef(start !== undefined);
  useEffect(() => {
    if (restored.current) {
      restored.current = false;
      return;
    }
    setDraft(saved ?? "");
  }, [saved]);
  const commit = () => {
    const v = draftSave(saved, draft);
    if (v !== null) onSave(v);
  };
  useLeaveSave(commit); // SET-036: changing page or closing keeps what was typed (draftSave is null when unchanged)
  return (
    <div className="look-select">
      <span>{label}</span>
      <input
        aria-label={label}
        className="field"
        placeholder={inherited}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        // an input method still composing (Hangul typed slowly, say) owns Enter
        onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && e.currentTarget.blur()}
      />
    </div>
  );
}

export function RepoView({ project, globalDir, onSave, outside, onOutside, start }: { project: Project; globalDir: string; onSave: (field: Field, value: string) => void; outside?: Outside | null; onOutside?: (own: boolean | null) => void; start?: Partial<Record<Field, string>> }) {
  return (
    <section className="conn-card" data-section="repo">
      <h2 className="conn-name">{projectLabel(project)}</h2>
      <p className="conn-detail">Folder: {project.path}</p>
      <DraftField label="Display name" saved={project.displayName} inherited={project.name} start={start?.displayName} onSave={(v) => onSave("displayName", v)} />
      <DraftField label="New workspaces start from" saved={project.base} inherited="the default branch" start={start?.base} onSave={(v) => onSave("base", v)} />
      <DraftField label="Workspaces folder" saved={project.workspacesDir} inherited={globalDir ? `${globalDir} (the global folder)` : "the global folder (Git & worktrees)"} start={start?.workspacesDir} onSave={(v) => onSave("workspacesDir", v)} />
      {outside && onOutside && <OutsideField outside={outside} onChoose={onOutside} />}
      <p className="conn-detail">Empty uses the value shown in grey. The icon is chosen from the project's own row in the sidebar.</p>
    </section>
  );
}

export default function RepoPage({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [globalDir, setGlobalDir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [outside, setOutside] = useState<Outside | null>(null);
  // C20-R4-01: what a leave save left behind (the typed text and, if the write failed, why), taken
  // once on mount so the boxes show it and the failure is said out loud.
  const [left] = useState<Partial<Record<Field, Left>>>(() => {
    const taken: Partial<Record<Field, Left>> = {};
    for (const f of ["displayName", "base", "workspacesDir"] as Field[]) {
      const l = takeLeft(keyOf(project.id, f));
      if (l) taken[f] = l;
    }
    return taken;
  });
  useEffect(() => {
    invoke<{ dir: string }>("workspaces_place_get")
      .then((p) => setGlobalDir(p.dir))
      .catch(() => setGlobalDir(""));
  }, []);
  useEffect(() => {
    invoke<{ key: string; global: boolean; own: boolean | null }[]>("visibility_get", { projectId: project.id })
      .then((list) => {
        const other = list.find((s) => s.key === "other");
        setOutside(other ? { global: other.global, own: other.own } : null);
      })
      .catch(() => setOutside(null));
  }, [project.id]);
  const chooseOutside = (own: boolean | null) => {
    invoke("visibility_set", { projectId: project.id, source: "other", show: own })
      .then(() => {
        setError(null);
        setOutside((o) => (o ? { ...o, own } : o));
      })
      .catch((e) => setError(String(e)));
  };
  const save = (field: Field, value: string) => {
    const key = keyOf(project.id, field);
    // C20-R4-01: the text goes aside before the write, so a write that outlives this page (a leave
    // save runs in unmount cleanup) still has somewhere to come back to.
    keepLeft(key, value);
    const done = (p: Project) => {
      clearLeft(key);
      setError(null);
      onSaved(p);
    };
    const failed = (e: unknown) => {
      failLeft(key, String(e));
      setError(String(e));
    };
    if (field === "displayName") {
      invoke<Project>("project_display_name_set", { projectId: project.id, name: value }).then(done).catch(failed);
      return;
    }
    const next = { workspacesDir: project.workspacesDir ?? "", base: project.base ?? "", [field]: value };
    invoke<Project>("project_set", { projectId: project.id, ...next }).then(done).catch(failed);
  };
  const leftErrors = (["displayName", "base", "workspacesDir"] as Field[]).flatMap((f) => (left[f]?.error ? [{ field: f, error: left[f]!.error! }] : []));
  return (
    <>
      {leftErrors.map(({ field, error: why }) => (
        <p className="conn-detail warn" role="alert" key={field}>
          The {FIELD_LABELS[field]} change could not be saved: {why}. What you typed is in the box.
        </p>
      ))}
      <RepoView project={project} globalDir={globalDir} onSave={save} outside={outside} onOutside={chooseOutside} start={{ displayName: left.displayName?.value, base: left.base?.value, workspacesDir: left.workspacesDir?.value }} />
      <RepoSetupSection path={project.path} />
      {error && (
        <p className="conn-detail warn" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
