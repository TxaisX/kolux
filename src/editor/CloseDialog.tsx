// EDIT-031 (T-236-b, CloseDialog.tsx): the prompt before tabs with unsaved text close. App asks `request(keys)` at the top of its
// close path; when it answers true the guard has taken over and App's own close runs later through `close(keys)`
// with only the keys that may go. Save writes each unsaved file (an untitled note asks for its name first);
// a file that does not save stays open with its text. Don't save drops the edits on purpose; Cancel closes nothing.
import { useEffect, useRef, useState } from "react";
import { trapTab } from "../chrome/dialogFocus";
import { baseName, diskOf, isDirty, textOf } from "./buffers";
import { askText, closable, mayRemove, saveAll, unsavedTabs, type Choice, type GuardPane, type Unsaved } from "./closeGuard";
import NamePrompt from "./NamePrompt";
import { needsName } from "./untitled";

/** EDIT-031: the editor's own save, loaded the first time the user picks Save. The prompt itself is
 *  drawn for any tab, so the window does not carry CodeMirror before a file is opened (cycle 3, first load). */
const saveQuiet = async (path: string, onToast?: (text: string) => void) => (await import("./EditorPane")).saveQuiet(path, onToast);

type Options = {
  panes: GuardPane[];
  dirty: Record<number, boolean>;
  /** Closes these tabs (App's own close, which still asks about running programs). */
  close: (keys: number[]) => void;
  toast: (text: string) => void;
};

export function useCloseGuard({ panes, dirty, close, toast }: Options) {
  const [ask, setAsk] = useState<{ keys: number[]; unsaved: Unsaved[]; answer?: (ok: boolean) => void } | null>(null);
  const open = useRef<{ keys: number[]; unsaved: Unsaved[]; answer?: (ok: boolean) => void } | null>(null);
  const [naming, setNaming] = useState<{ t: Unsaved; done: (ok: boolean) => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ close, toast });
  latest.current = { close, toast };

  /** True when some of the tabs hold unsaved text and the dialog is up: the caller closes nothing. */
  const request = (keys: number[]): boolean => {
    const unsaved = unsavedTabs(keys, panes, dirty);
    if (!unsaved.length) return false;
    open.current = { keys, unsaved };
    setAsk(open.current);
    return true;
  };

  /** EDIT-031 for a whole workspace: asks about the unsaved tabs among `keys` and resolves true when the
   *  caller may go on (the files saved, or the user chose Don't save), false on Cancel or a failed save.
   *  The caller's own removal drops the tabs and drafts; this only answers. */
  const confirm = (keys: number[]): Promise<boolean> => {
    const unsaved = unsavedTabs(keys, panes, dirty);
    if (!unsaved.length) return Promise.resolve(true);
    if (open.current) return Promise.resolve(false); // one question at a time
    return new Promise<boolean>((answer) => {
      open.current = { keys, unsaved, answer };
      setAsk(open.current);
    });
  };

  const done = (a: { keys: number[]; unsaved: Unsaved[]; answer?: (ok: boolean) => void }, choice: Choice, saved: ReadonlySet<number>) => {
    open.current = null;
    setAsk(null);
    if (a.answer) return a.answer(mayRemove(choice, a.unsaved, saved));
    const keys = closable(choice, a.keys, a.unsaved, saved);
    if (keys.length) latest.current.close(keys);
  };

  const choose = async (choice: Choice) => {
    const a = open.current;
    if (!a || busy) return;
    if (choice !== "save") return done(a, choice, new Set());
    setBusy(true);
    const saved = await saveAll(a.unsaved, {
      dirty: isDirty,
      needsName: (t) => needsName(t.path, t.root, diskOf(t.path)),
      write: (t) => saveQuiet(t.path, latest.current.toast),
      name: (t) => new Promise<boolean>((resolve) => setNaming({ t, done: resolve })),
    });
    setBusy(false);
    const kept = a.unsaved.filter((u) => !saved.has(u.key));
    if (kept.length) latest.current.toast(`${kept.length === 1 ? "1 file was" : `${kept.length} files were`} not saved and stay${kept.length === 1 ? "s" : ""} open: ${kept.map((k) => baseName(k.path)).join(", ")}.`);
    done(a, "save", saved);
  };

  const cancel = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ask) cancel.current?.focus();
  }, [ask]);
  // While a save runs the buttons are off and would drop the focus; the card keeps it so Tab and Escape stay inside.
  useEffect(() => {
    if (ask && busy) card.current?.focus();
  }, [busy]);

  const dialog = (
    <>
      {ask && !naming && (
        <div className="ask-backdrop" onMouseDown={() => void choose("cancel")}>
          <div
            ref={card}
            tabIndex={-1}
            className="ask"
            role="alertdialog"
            aria-modal="true"
            aria-label="Save changes before closing?"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              trapTab(e); // aria-modal: Tab stays inside (no stop while a save runs: every button is off)
              if (e.key === "Escape") (e.preventDefault(), void choose("cancel")); // choose() ignores it while a save runs
            }}
          >
            <h2 className="ask-title">Save changes before closing?</h2>
            <div className="ask-body">{askText(ask.unsaved.map((u) => baseName(u.path)))} Closing without saving loses them.</div>
            <div className="btn-row">
              <button ref={cancel} className="btn" disabled={busy} onClick={() => void choose("cancel")}>
                Cancel
              </button>
              <button className="btn danger" disabled={busy} onClick={() => void choose("discard")}>
                Don&apos;t save
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void choose("save")}>
                {ask.unsaved.length === 1 ? "Save" : "Save all"}
              </button>
            </div>
          </div>
        </div>
      )}
      {naming && naming.t.root && (
        <NamePrompt
          path={naming.t.path}
          root={naming.t.root}
          text={() => textOf(naming.t.path) ?? ""}
          onCancel={() => (naming.done(false), setNaming(null))}
          onSaved={(r) => {
            const { t, done } = naming;
            setNaming(null);
            if (r.note) latest.current.toast(r.note);
            // The suggested name saves in place. A new name wrote the file already; the tab is about to close, so
            // nothing needs to follow it (announceMoves would carry text for a tab that is leaving).
            if (r.same) void saveQuiet(t.path, latest.current.toast).then(done);
            else done(true);
          }}
        />
      )}
    </>
  );
  return { request, confirm, dialog };
}
