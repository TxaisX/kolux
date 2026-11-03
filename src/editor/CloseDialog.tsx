// EDIT-031 (T-236-b, CloseDialog.tsx): the prompt before tabs with unsaved text close. App asks `request(keys)` at the top of its
// close path; when it answers true the guard has taken over and App's own close runs later through `close(keys)`
// with only the keys that may go. Save writes each unsaved file (an untitled note asks for its name first);
// a file that does not save stays open with its text. Don't save drops the edits on purpose; Cancel closes nothing.
import { useEffect, useRef, useState } from "react";
import { baseName, diskOf, isDirty, textOf } from "./buffers";
import { askText, closable, saveAll, unsavedTabs, type GuardPane, type Unsaved } from "./closeGuard";
import NamePrompt from "./NamePrompt";
import { needsName } from "./untitled";

/** EDIT-031: the editor's own save, loaded the first time the user picks Save. The prompt itself is
 *  drawn for any tab, so the window does not carry CodeMirror before a file is opened (cycle 3, first load). */
const saveQuiet = async (path: string, onToast?: (text: string) => void) => (await import("./EditorPane")).saveQuiet(path, onToast);

/** The stop Tab (or Shift+Tab) moves to among `count` enabled controls when `at` has focus (-1: none), wrapping at the ends. */
export function tabStop(count: number, at: number, back: boolean): number {
  if (count <= 0) return -1;
  if (back) return at <= 0 ? count - 1 : at - 1;
  return at < 0 || at >= count - 1 ? 0 : at + 1;
}

type Options = {
  panes: GuardPane[];
  dirty: Record<number, boolean>;
  /** Closes these tabs (App's own close, which still asks about running programs). */
  close: (keys: number[]) => void;
  toast: (text: string) => void;
};

export function useCloseGuard({ panes, dirty, close, toast }: Options) {
  const [ask, setAsk] = useState<{ keys: number[]; unsaved: Unsaved[] } | null>(null);
  const [naming, setNaming] = useState<{ t: Unsaved; done: (ok: boolean) => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ close, toast });
  latest.current = { close, toast };

  /** True when some of the tabs hold unsaved text and the dialog is up: the caller closes nothing. */
  const request = (keys: number[]): boolean => {
    const unsaved = unsavedTabs(keys, panes, dirty);
    if (!unsaved.length) return false;
    setAsk({ keys, unsaved });
    return true;
  };

  const choose = async (choice: "save" | "discard" | "cancel") => {
    if (!ask || busy) return;
    if (choice !== "save") {
      setAsk(null);
      const keys = closable(choice, ask.keys, ask.unsaved, new Set());
      if (keys.length) latest.current.close(keys);
      return;
    }
    setBusy(true);
    const saved = await saveAll(ask.unsaved, {
      dirty: isDirty,
      needsName: (t) => needsName(t.path, t.root, diskOf(t.path)),
      write: (t) => saveQuiet(t.path, latest.current.toast),
      name: (t) => new Promise<boolean>((done) => setNaming({ t, done })),
    });
    setBusy(false);
    setAsk(null);
    const keys = closable("save", ask.keys, ask.unsaved, saved);
    const kept = ask.unsaved.filter((u) => !saved.has(u.key));
    if (kept.length) latest.current.toast(`${kept.length === 1 ? "1 file was" : `${kept.length} files were`} not saved and stay${kept.length === 1 ? "s" : ""} open: ${kept.map((k) => baseName(k.path)).join(", ")}.`);
    if (keys.length) latest.current.close(keys);
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
              if (e.key === "Escape") (e.preventDefault(), void choose("cancel")); // choose() ignores it while a save runs
              else if (e.key === "Tab") {
                // aria-modal: Tab stays among the dialog's own buttons.
                e.preventDefault();
                const stops = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")];
                const to = tabStop(stops.length, stops.indexOf(document.activeElement as HTMLElement), e.shiftKey);
                (stops[to] ?? e.currentTarget).focus();
              }
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
  return { request, dialog };
}
