// PROJ-002: the Add Project dialog. Its first step is the same with or without projects:
// cloning from a URL is the main choice, and opening a folder (Browse) and starting a new project
// sit beside it. Arrow keys move between the three, Enter takes the focused one, Escape closes.
// PROJ-003: the clone step fills in the target folder from the address, shows Git's progress,
// can be cancelled, and shows Git's own words when it fails. PROJ-004: the new-project step
// takes a name and a parent folder (the home folder to start with).
import { trapTab } from "../chrome/dialogFocus";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FolderPlus, Plus } from "../chrome/icons";
import { GLOSSARY } from "../glossary";
import type { Project } from "./model";

export type Step = "choose" | "clone" | "new";
const CHOICES = 3;

/** Where an arrow key moves focus among the choices (wrapping), or null for any other key. */
export function nextChoice(key: string, at: number): number | null {
  if (key === "ArrowDown" || key === "ArrowRight") return (at + 1) % CHOICES;
  if (key === "ArrowUp" || key === "ArrowLeft") return (at + CHOICES - 1) % CHOICES;
  return null;
}

/** Escape or a click outside: a clone under way asks first; Escape again keeps the copy going;
 *  anything else just closes. */
export function closeAction(busy: boolean, ticket: string, asking: boolean): "close" | "ask" | "keep" {
  if (!busy || ticket === "create" || ticket === "") return "close";
  return asking ? "keep" : "ask";
}

/** What the dialog asks the app to do; the default export wires it to the backend. */
export type Api = {
  suggest: (url: string) => Promise<{ url: string; dest: string }>;
  clone: (url: string, dest: string, ticket: string) => Promise<Project>;
  cancel: (ticket: string) => Promise<unknown>;
  defaults: () => Promise<{ parent: string; problem: string | null }>;
  create: (name: string, parent: string) => Promise<Project>;
  progress: (onLine: (ticket: string, line: string) => void) => () => void;
};

export type Form = { url: string; dest: string; destTyped: boolean; name: string; parent: string; problem: string; ticket: string; progress: string; error: string };
const EMPTY: Form = { url: "", dest: "", destTyped: false, name: "", parent: "", problem: "", ticket: "", progress: "", error: "" };

type ViewProps = {
  step: Step;
  onStep: (s: Step) => void;
  onBrowse: () => void;
  /** Type a path instead of using the picker, or change the workspaces folder (the sidebar's form). */
  onByPath?: () => void;
  onClose: () => void;
  api?: Api;
  onAdded?: (p: Project) => void;
  start?: Partial<Form>;
};

export function AddProjectView({ step, onStep, onBrowse, onByPath, onClose, api, onAdded, start }: ViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const choices = useRef<(HTMLButtonElement | null)[]>([]);
  const [f, setF] = useState<Form>({ ...EMPTY, ...start });
  const set = (p: Partial<Form>) => setF((o) => ({ ...o, ...p }));
  const ticket = useRef(f.ticket);
  ticket.current = f.ticket;
  const busy = f.ticket !== "";
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    // Focus stays inside the dialog on every step, so Escape always reaches it.
    if (step === "choose") choices.current[0]?.focus();
    else if (!box.current?.contains(document.activeElement)) box.current?.focus();
  }, [step]);
  useEffect(() => api?.progress((t, line) => t === ticket.current && set({ progress: line })), [api]);
  // The target folder follows the address until the user types one of their own.
  useEffect(() => {
    if (!api || f.destTyped || !f.url.trim()) return;
    let live = true;
    api.suggest(f.url).then((s) => live && set({ dest: s.dest }), () => {});
    return () => {
      live = false;
    };
  }, [api, f.url, f.destTyped]);
  useEffect(() => {
    if (step === "new" && api) api.defaults().then((d) => setF((o) => ({ ...o, parent: o.parent || d.parent, problem: d.problem ?? "" })), () => {});
  }, [api, step]);
  const run = (work: Promise<Project>) =>
    work.then(
      (p) => {
        set({ ticket: "", progress: "" });
        onAdded?.(p);
      },
      (err) => set({ ticket: "", progress: "", error: String(err) }),
    );
  const copy = () => {
    if (!api) return;
    const t = `clone-${Date.now()}`;
    set({ ticket: t, progress: "Starting the copy…", error: "" });
    run(api.clone(f.url, f.dest, t));
  };
  const create = () => {
    if (!api) return;
    set({ ticket: "create", progress: "Starting the project…", error: "" });
    run(api.create(f.name, f.parent));
  };
  // Closing the dialog part-way through a clone cancels it, so nothing is left half copied.
  const leave = () => {
    if (busy && f.ticket !== "create") api?.cancel(f.ticket);
    onClose();
  };
  const close = () => {
    const what = closeAction(busy, f.ticket, asking);
    if (what === "ask") setAsking(true);
    else if (what === "keep") setAsking(false);
    else leave();
  };
  return (
    <div className="ask-backdrop" onMouseDown={close}>
      <div
        ref={box}
        tabIndex={-1}
        className="ask add-project"
        role="dialog"
        aria-modal="true"
        aria-label="Add project"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          trapTab(e);
          if (e.key === "Escape") {
            e.preventDefault();
            close();
            return;
          }
          if (step !== "choose") return;
          const at = choices.current.findIndex((b) => b === e.target);
          const next = at < 0 ? null : nextChoice(e.key, at);
          if (next !== null) {
            e.preventDefault();
            choices.current[next]?.focus();
          }
        }}
      >
        <h2 className="ask-title">{step === "clone" ? GLOSSARY.clone.plain : step === "new" ? "New project" : "Add project"}</h2>
        {step === "choose" && (
          <>
            <button ref={(b) => { choices.current[0] = b; }} className="add-choice primary" title={GLOSSARY.clone.hover} onClick={() => onStep("clone")}>
              <span className="add-choice-name">{GLOSSARY.clone.plain}</span>
              <span className="add-choice-hint">Copy a project from GitHub or another Git host</span>
            </button>
            <div className="add-more">
              <button ref={(b) => { choices.current[1] = b; }} className="add-choice" onClick={onBrowse}>
                <FolderPlus size={13} />
                <span className="add-choice-name">Open a folder…</span>
              </button>
              <button ref={(b) => { choices.current[2] = b; }} className="add-choice" onClick={() => onStep("new")}>
                <Plus size={13} />
                <span className="add-choice-name">New project</span>
              </button>
            </div>
            {onByPath && (
              <button className="link" data-add-by-path onClick={onByPath}>
                Type a path, or change the workspaces folder…
              </button>
            )}
            <div className="btn-row">
              <button className="btn" data-add-close onClick={close}>
                Close
              </button>
            </div>
          </>
        )}
        {step === "clone" && (
          <form className="add-form" onSubmit={(e) => { e.preventDefault(); if (!busy && f.url.trim() && f.dest.trim()) copy(); }}>
            <label className="add-label">
              Web address
              <input aria-label="web address of the project" title="The Git repository URL" className="field" placeholder="https://github.com/owner/project.git" value={f.url} disabled={busy} onChange={(e) => set({ url: e.target.value, error: "" })} autoFocus />
            </label>
            <label className="add-label">
              Folder
              <input aria-label="folder the copy goes in" className="field" value={f.dest} disabled={busy} onChange={(e) => set({ dest: e.target.value, destTyped: true, error: "" })} />
            </label>
            <button type="submit" hidden />
          </form>
        )}
        {step === "new" && (
          <form className="add-form" onSubmit={(e) => { e.preventDefault(); if (!busy && f.name.trim() && !f.problem) create(); }}>
            <label className="add-label">
              Name
              <input aria-label="project name" className="field" placeholder="my-project" value={f.name} disabled={busy} onChange={(e) => set({ name: e.target.value, error: "" })} autoFocus />
            </label>
            <label className="add-label">
              Goes in
              <input aria-label="folder the project goes in" className="field" value={f.parent} disabled={busy} onChange={(e) => set({ parent: e.target.value, error: "" })} />
            </label>
            <button type="submit" hidden />
            {f.problem && <p className="add-error" role="alert">{f.problem}</p>}
          </form>
        )}
        {busy && <p className="ask-body add-progress" aria-live="polite">{f.progress}</p>}
        {f.error && <p className="add-error" role="alert">{f.error}</p>}
        {asking && busy && (
          <div role="alertdialog" aria-label="Stop copying?" data-add-stop-ask>
            <p className="ask-body">The copy is not finished. Stop it and close? Nothing half copied is kept.</p>
            <div className="btn-row">
              <button className="btn" autoFocus onClick={() => setAsking(false)}>
                Keep copying
              </button>
              <button className="btn danger" onClick={leave}>
                Stop and close
              </button>
            </div>
          </div>
        )}
        {step !== "choose" && (
          <div className="btn-row">
            <button className="btn" onClick={() => onStep("choose")} disabled={busy}>
              Back
            </button>
            <button className="btn" onClick={onBrowse} disabled={busy}>
              Open a folder…
            </button>
            {step === "clone" && busy && (
              <button className="btn" onClick={() => api?.cancel(f.ticket)}>
                Cancel
              </button>
            )}
            {step === "clone" && !busy && (
              <button className="btn primary" disabled={!f.url.trim() || !f.dest.trim()} title={GLOSSARY.clone.hover} onClick={copy}>
                Copy
              </button>
            )}
            {step === "new" && (
              <button className="btn primary" disabled={busy || !f.name.trim() || f.problem !== ""} onClick={create}>
                Create
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const BACKEND: Api = {
  suggest: (url) => invoke("clone_suggest", { url }),
  clone: (url, dest, ticket) => invoke("project_clone", { url, dest, ticket }),
  cancel: (ticket) => invoke("clone_cancel", { ticket }),
  defaults: () => invoke("project_new_defaults"),
  create: (name, parent) => invoke("project_create", { name, parent }),
  progress: (onLine) => {
    const off = listen<{ ticket: string; line: string }>("clone-progress", (e) => onLine(e.payload.ticket, e.payload.line));
    return () => void off.then((stop) => stop());
  },
};

/** The dialog with its own step; `onBrowse` runs the folder picker after the dialog closes, and
 *  `onAdded` gets a project cloned or created here. */
export default function AddProject({ onBrowse, onByPath, onClose, onAdded }: { onBrowse: () => void; onByPath?: () => void; onClose: () => void; onAdded: (p: Project) => void }) {
  const [step, setStep] = useState<Step>("choose");
  return (
    <AddProjectView
      step={step}
      onStep={setStep}
      onBrowse={() => {
        onClose();
        onBrowse();
      }}
      onByPath={onByPath}
      onClose={onClose}
      api={BACKEND}
      onAdded={onAdded}
    />
  );
}
