// EDIT-054 (T-236-b / T-237-b): the box that asks for a name on the first save of an untitled note. It starts
// on the current name (accepting it simply saves), shows why a name is refused and changes nothing on disk until
// the name is accepted. The disk steps are in firstSave.ts; this is the real set of file commands behind them.
import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { firstSave, type FirstSave, type FirstSaveIo } from "./firstSave";
import { suggestedName } from "./untitled";
import { Dialog } from "../ui/Dialog";

const realIo: FirstSaveIo = {
  exists: (full) => invoke<(unknown | null)[]>("file_stamps", { paths: [full] }).then((r) => (r?.[0] ?? null) !== null),
  makeFolder: (parent, name) =>
    invoke("fs_create", { dir: parent, name, folder: true }).then(
      () => undefined,
      (e) => {
        // A folder that is already there is what we wanted.
        if (/already exists/i.test(String(e))) return;
        throw e;
      },
    ),
  write: (full, text) => invoke("file_write", { path: full, text }).then(() => undefined),
  remove: (full) => invoke("fs_trash", { paths: [full] }).then(() => undefined),
};

/** The first save against the real disk. */
export const firstSaveReal = (root: string, oldPath: string, typed: string, text: string): Promise<FirstSave> => firstSave(realIo, root, oldPath, typed, text);

/** What a key does in the box: Escape cancels and Enter saves, except while an input method is composing (the key then
 *  belongs to it) and except on a button (Enter on Cancel presses Cancel, not Save). */
export function nameKey(key: string, composing: boolean, onButton: boolean): "cancel" | "accept" | null {
  if (composing) return null;
  if (key === "Escape") return "cancel";
  if (key === "Enter" && !onButton) return "accept";
  return null;
}

type Props = {
  path: string;
  root: string;
  /** The note's text when the name is accepted. */
  text: () => string;
  /** The name was accepted and the note saved under it (same: the suggested name, saved in place by the caller). */
  onSaved: (r: { path: string; same: boolean; note?: string }) => void;
  onCancel: () => void;
  /** W201 B2: asked from a dialog that stays mounted under it (the unsaved guard), so it takes the same raised
   *  backdrop as that dialog: one step over every other dialog, whatever order the page draws them in. */
  raised?: boolean;
};

export default function NamePrompt({ path, root, text, onSaved, onCancel, raised = false }: Props) {
  const [name, setName] = useState(suggestedName(path));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const accept = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void firstSaveReal(root, path, name, text()).then(
      (r) => {
        setBusy(false);
        if (r.ok) onSaved(r);
        else setError(r.error);
      },
      (e) => {
        setBusy(false);
        setError(String(e));
      },
    );
  };
  return (
    // src/ui Dialog: the name field takes focus with its text selected, Tab stays inside, Escape (unless an input method
    // is composing) and a click outside cancel, and focus goes back to where it was.
    <Dialog
      onClose={onCancel}
      label="Name this note"
      className="ask"
      viewport={raised ? "ask-backdrop guard" : "ask-backdrop"}
      initialFocus={() => (input.current?.select(), input.current)}
      tabIndex={-1}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (nameKey(e.key, e.nativeEvent.isComposing || e.keyCode === 229, (e.target as HTMLElement).tagName === "BUTTON") === "accept") (e.preventDefault(), accept());
      }}
    >
      <h2 className="ask-title">Name this note</h2>
      <div className="ask-body">Choose a file name inside this workspace. Folders are made as needed, and .md is added when there is no extension.</div>
      <input ref={input} className="field" value={name} aria-label="File name" aria-invalid={error !== null} onChange={(e) => (setName(e.target.value), setError(null))} />
      {error && (
        <div className="ask-body" role="alert" style={{ color: "var(--danger, #e5534b)" }}>
          {error}
        </div>
      )}
      <div className="btn-row">
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={accept}>
          Save
        </button>
      </div>
    </Dialog>
  );
}
