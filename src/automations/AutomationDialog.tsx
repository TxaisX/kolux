// The one dialog that creates or edits an automation (AUTO-005) and sets its timetable (AUTO-001):
// a roomy prompt editor with a find bar on the left, the settings in a column on the right, and a
// live preview of the timetable that shows the checker's message when the line will not do. The
// back end checks everything again on save; one request id per opening means a double click or a
// repeated save leaves one automation. Create and edit on the command line (CLI-029) are T-197.
// The clock time is an hour box, a minute box and AM or PM (AUTO-003); Custom shows the line, its
// five field chips and a status line that reads it back in words (AUTO-002); the header and the
// empty page offer the starter templates (AUTO-006).
import { trapTab } from "../chrome/dialogFocus";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import Ask from "../chrome/Ask";
import { noteUse } from "../onboarding/features";
import type { AgentInfo } from "../launch/PlusMenu";
import { folderName, type Project, type Worktree } from "../projects/model";
import { closesOnScrim, defaultForm, EVENT_CHOICES, findNext, hermesEdit, hermesSchedule, scheduleChanged, GRACE, PRECHECK, preselect, type Automation, type Preset, type ScheduleForm } from "./model";
import { probeSetup } from "../settings/setupProbe";
import SearchPick from "../editor/SearchPick";
import { clampBox, cronWords, fieldNames, from12, nudge, templates, to12, toPreset, weekdayNames, type Template } from "./timetable";

type Props = {
  projects: Project[];
  agents: AgentInfo[];
  /** The latest saved copy when editing (the page fetches it first), or null for a new one. */
  editing: Automation | null;
  /** AUTO-006: a new automation's starting point; it only fills the form. */
  template?: Template | null;
  onClose: () => void;
  onSaved: (a: Automation) => void;
};

const providers = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "gemini", name: "Gemini" },
];
const presets: Array<{ value: Preset; label: string }> = [
  { value: "hourly", label: "Every hour" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Monday to Friday" },
  { value: "weekly", label: "Once a week" },
  { value: "custom", label: "Custom (cron or RRULE)" },
];
/** The interface language: the window's own, which follows the system's. */
const locale = () => (typeof navigator !== "undefined" && navigator.language) || "en-US";
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** The four starting points and a blank one, on the empty page and from the dialog's header. */
export function TemplateCards({ onPick, disabled }: { onPick: (t: Template | null) => void; disabled?: boolean }) {
  return (
    <div className="auto-templates">
      {templates.map((t) => (
        <button key={t.id} className="auto-template" disabled={disabled} onClick={() => onPick(t)}>
          <b>{t.name}</b>
          <span>{t.blurb}</span>
        </button>
      ))}
      <button className="auto-template" disabled={disabled} onClick={() => onPick(null)}>
        <b>Start from blank</b>
        <span>An empty form</span>
      </button>
    </div>
  );
}

/** One number box: typing is free, leaving it snaps into range, the arrow keys nudge it. */
function TimeBox({ label, value, lo, hi, twoDigits, onValue }: { label: string; value: number; lo: number; hi: number; twoDigits?: boolean; onValue: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (n: number) => {
    setDraft(null);
    onValue(n);
  };
  return (
    <input
      className="field auto-box"
      inputMode="numeric"
      aria-label={label}
      value={draft ?? (twoDigits ? String(value).padStart(2, "0") : String(value))}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 2))}
      onBlur={() => draft !== null && commit(clampBox(draft, lo, hi))}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        commit(nudge(draft === null ? value : clampBox(draft, lo, hi), e.key === "ArrowUp" ? 1 : -1, lo, hi));
      }}
    />
  );
}

/** AUTO-010: whether a run's new worktree runs the project setup, or null when the choice is not
 * offered: only a new worktree per run, in a project known to have a setup. */
export function setupChoice(mode: "existing" | "new-per-run", hasSetup: boolean | null, chosen: boolean): boolean | null {
  return mode === "new-per-run" && hasSetup === true ? chosen : null;
}

/** Whether any field the form submits differs from what the dialog opened with: closing then asks first. */
export const unsaved = (first: Record<string, unknown>, now: Record<string, unknown>): boolean => [...new Set([...Object.keys(first), ...Object.keys(now)])].some((k) => JSON.stringify(first[k]) !== JSON.stringify(now[k]));

/** Save's hint while it is held: the real reason when the worktrees could not be read, else that they are still being read. */
export const saveHint = (ready: boolean, setupError: string | null): string | undefined => (ready ? undefined : setupError !== null ? "The project's worktrees could not be read; use Try again" : "Waiting for the project's worktrees");

/** The worktrees could not be read: the reason, and a way to ask again. */
export function WorktreeError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="note error" role="alert">
      Kolux cannot read this project's worktrees yet, so it will not save: {error}{" "}
      <button className="btn" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** What the page selects after a Hermes job is saved, until the next read brings the real row. */
const hermesStub: Automation = { id: "", name: "", prompt: "", provider: "hermes", projectId: "", enabled: true, source: "hermes", local: true };

export default function AutomationDialog({ projects, agents, editing, template, onClose, onSaved }: Props) {
  const [requestId] = useState(() => `req-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const start = editing ? null : template;
  const [name, setName] = useState(editing?.name ?? start?.name ?? "");
  const [prompt, setPrompt] = useState(editing?.prompt ?? start?.prompt ?? "");
  const [provider, setProvider] = useState(editing?.provider ?? "claude");
  const [projectId, setProjectId] = useState(editing?.projectId ?? projects[0]?.id ?? "");
  const [mode, setMode] = useState<"existing" | "new-per-run">(editing?.workspaceMode ?? "existing");
  const [workspace, setWorkspace] = useState(editing?.workspace ?? "");
  const [base, setBase] = useState(editing?.baseBranch ?? "");
  // EDIT-048: the project's branches narrow as the base branch is typed (the box stays free text when the list cannot be read).
  const [branches, setBranches] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setBranches([]);
    if (projectId) invoke<string[]>("workspace_branches", { projectId }).then((b) => live && setBranches(b), () => undefined);
    return () => {
      live = false;
    };
  }, [projectId]);
  const [runSetup, setRunSetup] = useState(editing?.runSetup ?? false);
  const [reuse, setReuse] = useState(editing?.reuseSession ?? false);
  const [hasSetup, setHasSetup] = useState<boolean | null>(null);
  const [grace, setGrace] = useState(editing?.missedRunGraceMinutes ?? start?.graceMinutes ?? 0);
  const [precheck, setPrecheck] = useState(editing?.precheck ?? "");
  const [limit, setLimit] = useState(editing?.precheckTimeoutSeconds ?? 60);
  const [form, setForm] = useState<ScheduleForm>(editing?.form ?? start?.form ?? defaultForm);
  // AUTO-004: a timetable or an event; only pull request opened is spotted so far (T-085-c).
  const [starts, setStarts] = useState(editing?.trigger?.kind === "event" ? editing.trigger.event : "schedule");
  // AUTO-002: what was typed into Custom, given back after a visit to a preset.
  const [typed, setTyped] = useState<string | null>(editing?.form?.preset === "custom" ? editing.form.custom : null);
  const [chooser, setChooser] = useState(false);
  const [zone, setZone] = useState((editing?.trigger?.kind === "schedule" && editing.trigger.timezone) || localZone());
  const [worktrees, setWorktrees] = useState<Worktree[] | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ timetable: string; nextRunLabel: string; trigger?: { cron?: string } } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const editor = useRef<HTMLTextAreaElement>(null);
  const find = useRef<HTMLInputElement>(null);
  const project = projects.find((p) => p.id === projectId);
  const schedule = { ...form, timezone: zone };

  // AUTO-005: the project's worktrees; saving waits until Kolux has read them.
  useEffect(() => {
    setWorktrees(null);
    setSetupError(null);
    if (!projectId) return;
    let live = true;
    readWorktrees(projectId, () => live);
    return () => {
      live = false;
    };
  }, [projectId]);

  // AUTO-010: whether the project has a setup (kolux.yaml in its folder); one cmd cannot run as
  // written still counts, since it is there to be chosen.
  const projectPath = project?.path;
  useEffect(() => {
    setHasSetup(null);
    if (!projectPath) return;
    let live = true;
    // asks the page's own read (no trust question, nothing started); a failed read keeps the option
    void probeSetup(projectPath, true).then((has) => live && setHasSetup(has));
    return () => {
      live = false;
    };
  }, [projectPath]);
  const setupShown = setupChoice(mode, hasSetup, runSetup);

  useEffect(() => {
    let live = true;
    invoke<{ timetable: string; nextRunLabel: string; trigger?: { cron?: string } }>("automation_preview", { input: schedule })
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setPreviewError(null);
      })
      .catch((e) => {
        if (!live) return;
        setPreview(null);
        setPreviewError(String(e));
      });
    return () => {
      live = false;
    };
  }, [form.preset, form.time, form.day, form.custom, zone]);

  // T-193-b: a job can live in Hermes instead; an existing job keeps the tool it came from. These two
  // states sit after every older hook so the saved-card tests that address hooks by number still line up.
  const [where, setWhere] = useState<"kolux" | "hermes">(editing?.source === "hermes" ? "hermes" : "kolux");
  const [folder, setFolder] = useState(editing?.workspace ?? "");
  // Closing with any changed field asks first; a press and release that do not both land on the scrim do not close it.
  const [leaving, setLeaving] = useState(false);
  const fields = () => ({ name, prompt, provider, projectId, mode, workspace, base, runSetup, reuse, grace, precheck, limit, form, zone, starts, where, folder });
  const first = useRef(fields());
  const seeded = useRef(false);
  const workspaceNow = useRef(workspace);
  workspaceNow.current = workspace;
  const downOnScrim = useRef(false);
  const upOnScrim = useRef(false);
  const wanted = useRef(projectId);
  wanted.current = projectId;
  const close = () => (unsaved(first.current, fields()) ? setLeaving(true) : onClose());
  // Reads the project's worktrees (also the Try again button): Save waits for them, and says why when they cannot be read.
  const readWorktrees = (id: string, alive: () => boolean) => {
    setWorktrees(null);
    setSetupError(null);
    invoke<Worktree[]>("workspace_list", { projectId: id })
      .then((list) => {
        if (!alive()) return;
        setWorktrees(list);
        const chosen = list.some((t) => t.path === workspaceNow.current) ? workspaceNow.current : preselect(list);
        // The first read picks a worktree for the user; that is part of how the dialog opened, not a change they made.
        if (!seeded.current && workspaceNow.current === first.current.workspace) first.current = { ...first.current, workspace: chosen };
        seeded.current = true;
        setWorkspace(chosen);
      })
      .catch((e) => {
        if (alive()) setSetupError(String(e));
      });
  };
  const hermes = where === "hermes";
  const timed = hermes || starts === "schedule";
  // A Hermes job whose timetable is not a cron line (for example "every 120m") shows it as text and keeps it as it is.
  const fixedSchedule = hermes && !!editing && !editing.form;
  const showTimetable = timed && !fixedSchedule;
  // Editing a Hermes job: the timetable is a need only when the user moved its fields.
  const needsCron = hermes && !fixedSchedule && (!editing || scheduleChanged(editing, form));

  const findFrom = (from: number) => {
    const at = findNext(prompt, findQuery, from);
    const box = editor.current;
    if (at < 0 || !box) return;
    box.focus();
    box.setSelectionRange(at, at + findQuery.length);
  };
  const keys = (e: KeyboardEvent) => {
    trapTab(e);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      // Escape shuts the find bar before it shuts the dialog.
      if (findOpen) {
        setFindOpen(false);
        editor.current?.focus();
      } else close();
    } else if (e.key === "f" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setFindOpen(true);
      window.setTimeout(() => find.current?.select(), 0);
    }
  };

  const ready = hermes || (worktrees !== null && setupError === null);
  const cron = hermesSchedule(preview?.trigger?.cron ?? "");
  const hermesError = hermes && needsCron && preview && !cron ? "Hermes takes a cron timetable (five fields, like 0 9 * * 1-5), not an RRULE." : null;
  const save = () => {
    if (saving || !ready) return;
    setSaving(true);
    setSaveError(null);
    if (hermes) {
      // Hermes makes and changes its own job; Kolux only passes things on. Hermes takes no time zone, so none is sent.
      // An edit sends only the fields that changed, so the schedule it already has is never rewritten by accident.
      const input = editing ? hermesEdit(editing, { name, prompt, form, cron }) : { name, prompt, schedule: cron, workspace: folder.trim() || null };
      if (editing && Object.keys(input).length === 0) {
        onClose();
        return;
      }
      invoke("automation_external_act", { tool: "hermes", action: editing ? "edit" : "create", id: editing?.jobId ?? "", input })
        .then(() => invoke("automations_external_refresh").catch(() => {}))
        .then(() => {
          noteUse("automations");
          onSaved({ ...(editing ?? hermesStub), name, prompt });
          onClose();
        })
        .catch((e) => {
          setSaveError(String(e));
          setSaving(false);
        });
      return;
    }
    const input = { id: editing?.id, requestId, name, prompt, provider, projectId, workspaceMode: mode, workspace: mode === "existing" ? workspace : null, baseBranch: mode === "new-per-run" ? base : "", runSetup: setupShown === true, reuseSession: mode === "existing" && reuse, missedRunGraceMinutes: grace, precheck, precheckTimeoutSeconds: limit, schedule, trigger: timed ? undefined : { kind: "event", event: starts } };
    invoke<Automation>("automation_save", { input })
      .then((a) => {
        noteUse("automations");
        onSaved(a);
        onClose();
      })
      .catch((e) => {
        setSaveError(String(e));
        setSaving(false);
      });
  };
  const pick = (t: Template | null) => {
    setName(t?.name ?? "");
    setPrompt(t?.prompt ?? "");
    setForm(t?.form ?? defaultForm);
    setGrace(t?.graceMinutes ?? 0);
    setTyped(null);
    setChooser(false);
  };
  const clock = to12(form.time || "09:00");
  const setClock = (hour: number, minute: number, pm: boolean) => setForm({ ...form, time: from12(hour, minute, pm) });
  const lang = locale();
  const hits = findQuery ? prompt.toLowerCase().split(findQuery.toLowerCase()).length - 1 : 0;
  const choices = providers.map((p) => ({ ...p, name: agents.find((a) => a.id === p.id)?.name ?? p.name }));

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        downOnScrim.current = e.target === e.currentTarget;
        upOnScrim.current = false;
      }}
      onMouseUp={(e) => {
        upOnScrim.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && closesOnScrim(downOnScrim.current, upOnScrim.current)) close();
        downOnScrim.current = false;
        upOnScrim.current = false;
      }}
    >
      <div className="auto-dialog" role="dialog" aria-modal="true" tabIndex={-1} aria-label={editing ? `Edit ${editing.name}` : "New Automation"} onKeyDown={keys}>
        <div className="auto-dialog-head">
          <h2>{editing ? "Edit automation" : "New Automation"}</h2>
          {!editing && (
            <button className="btn" aria-expanded={chooser} onClick={() => setChooser(!chooser)}>
              Templates
            </button>
          )}
        </div>
        {chooser && !editing && <TemplateCards onPick={pick} />}
        <div className="auto-dialog-body">
          <div className="auto-dialog-main">
            <label className="auto-label">
              Name
              <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning checks" />
            </label>
            <div className="auto-label grow">
              <span>Prompt</span>
              {findOpen && (
                <div className="auto-find" role="search">
                  <input
                    ref={find}
                    className="field"
                    aria-label="Find in prompt"
                    placeholder="Find"
                    value={findQuery}
                    onChange={(e) => setFindQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        findFrom(editor.current?.selectionEnd ?? 0);
                      }
                    }}
                  />
                  <span className="muted">{findQuery ? `${hits} found` : ""}</span>
                  <button className="btn" onClick={() => findFrom(editor.current?.selectionEnd ?? 0)}>
                    Next
                  </button>
                </div>
              )}
              <textarea ref={editor} className="field auto-prompt" aria-label="Prompt" spellCheck={false} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="What the agent starts with. Ctrl+F finds text in it." />
            </div>
          </div>
          <div className="auto-dialog-side">
            {!editing && (
              <label className="auto-label">
                Runs in
                <select className="field" value={where} onChange={(e) => setWhere(e.target.value as "kolux" | "hermes")}>
                  <option value="kolux">Kolux</option>
                  <option value="hermes">Hermes</option>
                </select>
              </label>
            )}
            {hermes && <span className="muted">Hermes keeps this job and runs it on this computer on its own schedule. Kolux lists it and can pause, run, edit or remove it.</span>}
            {hermes && !editing && (
              <label className="auto-label">
                Work folder
                <input className="field" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="Optional, for example C:\work\notes" />
              </label>
            )}
            {!hermes && (
            <>
            <label className="auto-label">
              Agent
              <select className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {choices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="auto-label">
              Project
              <select className="field" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="auto-label">
              <legend>Workspace</legend>
              <label className="auto-radio">
                <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> An existing worktree
              </label>
              {mode === "existing" && (
                <label className="auto-radio">
                  <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} /> Continue in the session the last run left open, when the agent is idle there
                </label>
              )}
              {mode === "existing" && (
                <select className="field" aria-label="Worktree" value={workspace} disabled={!worktrees} onChange={(e) => setWorkspace(e.target.value)}>
                  {(worktrees ?? []).map((w) => (
                    <option key={w.path} value={w.path}>
                      {w.isMain ? `${folderName(w.path)} (main)` : (w.name ?? folderName(w.path))}
                    </option>
                  ))}
                </select>
              )}
              <label className="auto-radio">
                <input type="radio" checked={mode === "new-per-run"} onChange={() => setMode("new-per-run")} /> A new worktree for every run
              </label>
              {mode === "new-per-run" && <SearchPick items={branches} label="Base branch" value={base} onChange={setBase} placeholder={`From ${project?.base || "the default branch"}`} />}
              {setupShown !== null && (
                <label className="auto-radio">
                  <input type="checkbox" checked={setupShown} onChange={(e) => setRunSetup(e.target.checked)} /> Run the project setup in each new worktree
                </label>
              )}
            </fieldset>
            </>
            )}
            {!hermes && (
            <label className="auto-label">
              Starts
              <select className="field" value={starts} onChange={(e) => setStarts(e.target.value)}>
                <option value="schedule">On a timetable</option>
                {EVENT_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            )}
            {fixedSchedule && (
              <div className="auto-label">
                <span>Timetable</span>
                <span className="muted">{editing?.timetable || "Set in Hermes"}. Hermes keeps this timetable; change it in Hermes.</span>
              </div>
            )}
            {showTimetable && (
              <>
              <label className="auto-label">
                {hermes ? "Cron timetable" : "Timetable"}
                <select className="field" value={form.preset} onChange={(e) => setForm(toPreset(form, e.target.value as Preset, typed))}>
                  {presets.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              {form.preset === "weekly" && (
                <label className="auto-label">
                  Day
                  <select className="field" value={form.day ?? 1} onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}>
                    {weekdayNames(lang).map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {form.preset !== "custom" && (
                <div className="auto-label">
                  <span>{form.preset === "hourly" ? "Minutes past the hour" : "Time"}</span>
                  <div className="auto-time">
                    {form.preset !== "hourly" && (
                      <>
                        <TimeBox label="Hour" value={clock.hour} lo={1} hi={12} onValue={(h) => setClock(h, clock.minute, clock.pm)} />
                        <span>:</span>
                      </>
                    )}
                    <TimeBox label="Minute" value={clock.minute} lo={0} hi={59} twoDigits onValue={(m) => setClock(clock.hour, m, clock.pm)} />
                    {form.preset !== "hourly" && (
                      <select className="field" aria-label="AM or PM" value={clock.pm ? "PM" : "AM"} onChange={(e) => setClock(clock.hour, clock.minute, e.target.value === "PM")}>
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </select>
                    )}
                  </div>
                </div>
              )}
              {form.preset === "custom" && (
                <label className="auto-label">
                  Cron line or RRULE
                  <input
                    className="field mono"
                    value={form.custom}
                    onChange={(e) => {
                      setTyped(e.target.value);
                      setForm({ ...form, custom: e.target.value });
                    }}
                    placeholder="0 9 * * 1-5"
                  />
                  <span className="auto-chips">
                    {fieldNames(lang).map((n) => (
                      <span key={n} className="chip">
                        {n}
                      </span>
                    ))}
                  </span>
                </label>
              )}
              {!hermes && (
              <label className="auto-label">
                Time zone
                <input className="field" value={zone} onChange={(e) => setZone(e.target.value)} />
              </label>
              )}
              {!hermes && (
              <label className="auto-label">
                If Kolux was away at the time
                <select className="field" value={grace} onChange={(e) => setGrace(Number(e.target.value))}>
                  {GRACE.map(([m, word]) => (
                    <option key={m} value={m}>
                      {word}
                    </option>
                  ))}
                </select>
              </label>
              )}
              </>
            )}
            {!timed && <span className="muted">{EVENT_CHOICES.find((c) => c.value === starts)?.help}</span>}
            {!hermes && (
            <>
            <label className="auto-label">
              Precheck command
              <input className="field" value={precheck} placeholder="Optional, for example: git diff --quiet" onChange={(e) => setPrecheck(e.target.value)} />
              <span className="muted">Runs in the run's folder ahead of a timed or event-started run, never ahead of Run now. Anything but exit code 0 skips the run.</span>
            </label>
            <label className="auto-label">
              Precheck time limit
              <select className="field" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                {PRECHECK.map(([s, word]) => (
                  <option key={s} value={s}>
                    {word}
                  </option>
                ))}
              </select>
            </label>
            </>
            )}
            {hermesError && (
              <div className="note error" role="alert">
                {hermesError}
              </div>
            )}
            {!showTimetable ? null : previewError ? (
              <div className="note error" role="alert">
                {form.preset === "custom" ? `Invalid: ${previewError}` : previewError}
              </div>
            ) : (
              preview && (
                <div className="auto-preview" role="status">
                  {form.preset === "custom" ? `Valid: ${cronWords(form.custom, lang) ?? preview.timetable}${hermes ? "" : ` (${zone})`}` : preview.timetable}
                  <br />
                  Next run: {preview.nextRunLabel}
                </div>
              )
            )}
          </div>
        </div>
        {!hermes && setupError && <WorktreeError error={setupError} onRetry={() => readWorktrees(projectId, () => wanted.current === projectId)} />}
        {saveError && (
          <div className="note error" role="alert">
            {saveError}
          </div>
        )}
        <div className="auto-dialog-foot">
          <span className="muted">{`Once saved, it keeps running ${timed ? "on this timetable" : "on each event"} until you pause it.`}</span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={saving || !ready || (showTimetable && previewError !== null) || (hermes && (!prompt.trim() || (needsCron && !cron)))} onClick={save} title={saveHint(ready, setupError)}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      {leaving && (
        <Ask
          title="Discard your changes?"
          body="Some of what you changed in this form is not saved."
          confirm="Discard"
          cancel="Keep editing"
          onConfirm={() => onClose()}
          onCancel={() => {
            setLeaving(false);
            window.setTimeout(() => editor.current?.focus(), 0);
          }}
        />
      )}
    </div>
  );
}
