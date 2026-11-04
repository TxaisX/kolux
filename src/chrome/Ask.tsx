// VIEW-116: the one confirmation dialog. Cancel holds focus when it opens, so a stray Enter backs
// out; Enter confirms only on prompts that opt in (`enter`) and only while Confirm has focus;
// Escape always cancels. The don't-ask-again tick lives in this dialog alone: it is handed over
// only with a confirm, and the next prompt (a new dialog) starts unticked. With `confirm` null it
// only explains, with a single OK (ACCT-015's Disconnect when nothing can be disconnected).
import { useRef, useState, type ReactNode } from "react";
import { useDialogFocus } from "./dialogFocus";

/** What a key press in the dialog does: Escape cancels; Enter on Confirm is blocked unless the
 * prompt opts in; anything else (Enter on Cancel included) does what the focused control does. */
export const askKey = (key: string, onConfirm: boolean, enter: boolean): "cancel" | "block" | "pass" => (key === "Escape" ? "cancel" : key === "Enter" && onConfirm && !enter ? "block" : "pass");

/** A question held in state until it is drawn; `confirm` null only explains. */
export type Question = { title: string; body: string; confirm: string | null };

type Props = {
  title: string;
  body: ReactNode;
  /** The confirm button's word, e.g. Delete; null shows only an OK that closes. */
  confirm: string | null;
  /** Lets Enter confirm while the confirm button has focus. */
  enter?: boolean;
  /** Offers a don't-ask-again box; its tick reaches `onConfirm` and nowhere else. */
  dontAsk?: boolean;
  /** The back-out button's words; Cancel unless the prompt names its own. */
  cancel?: string;
  /** A confirm that loses nothing (ONB-006 Skip) is not drawn in the danger colour. */
  safe?: boolean;
  /** The work the confirm started is already running and cannot be stopped: Keep, Escape and a click
   * outside do nothing (they would only close the dialog). Confirm still works, so a prompt whose own
   * operation can finish stays usable. */
  locked?: boolean;
  onConfirm: (dontAskAgain: boolean) => void;
  onCancel: () => void;
};

export default function Ask({ title, body, confirm, enter = false, dontAsk = false, cancel: cancelText = "Cancel", safe = false, locked = false, onConfirm, onCancel }: Props) {
  const [tick, setTick] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // C28-R1-01: while locked the three back-outs (Keep, Escape, a click outside) all land here and go nowhere.
  // The control is still focusable and named: focus starts on Keep (below) and a greyed button that cannot be
  // reached would strand the keyboard outside the dialog.
  const backOut = () => {
    if (!locked) onCancel();
  };
  // Cancel holds focus when it opens; Tab stays inside; Escape works from anywhere (not only from a focused control);
  // focus goes back to what had it when the dialog closes. useDialogFocus reads onClose fresh each render, so the
  // lock is seen as soon as `locked` turns true.
  useDialogFocus(box, backOut, () => cancel.current);
  return (
    <div className="ask-backdrop" onMouseDown={backOut}>
      <div
        ref={box}
        className="ask"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          const what = askKey(e.key, e.target === ok.current, enter);
          if (what !== "pass") e.preventDefault();
          if (what === "cancel") backOut();
        }}
      >
        <h2 className="ask-title">{title}</h2>
        <div className="ask-body">{body}</div>
        {dontAsk && (
          <label className="check ask-check">
            <input type="checkbox" checked={tick} onChange={(e) => setTick(e.target.checked)} /> Don&apos;t ask again
          </label>
        )}
        <div className="btn-row">
          {confirm === null ? (
            <button ref={cancel} className="btn primary" onClick={backOut}>
              OK
            </button>
          ) : (
            <>
              <button ref={cancel} className="btn" aria-disabled={locked || undefined} onClick={backOut}>
                {cancelText}
              </button>
              <button ref={ok} className={safe ? "btn primary" : "btn danger"} onClick={() => onConfirm(tick)}>
                {confirm}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
