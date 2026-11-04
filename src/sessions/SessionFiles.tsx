// VIEW 089 (T-153-d): Show file, Open file and Delete on a past session's row. Delete asks first, in
// the row itself (the window never shows a browser dialog).
import { useEffect, useRef, useState } from "react";
import { deleteQuestion, runFileAction, type FileAction } from "./files";
import type { Session } from "./model";

type Props = {
  session: Pick<Session, "agent" | "id"> & { title?: string };
  onNote: (text: string) => void;
  onDeleted: () => void;
  /** Starts with the question showing (tests). */
  asking?: boolean;
  /** C28-R5-01: the (agent, session) pairs the window has open in a pane; Delete warns about this row's
   *  own and the back end refuses it. A warning, not a second gate: a retained pane holds no writer. */
  open?: readonly [string, string][];
};

export const heldByPane = (open: readonly [string, string][], s: Pick<Session, "agent" | "id">): boolean => open.some(([agent, id]) => agent === s.agent && id === s.id);

export default function SessionFiles({ session, onNote, onDeleted, asking = false, open = [] }: Props) {
  const [ask, setAsk] = useState(asking);
  // Swapping Delete… for Keep must not drop the keyboard: Keep takes focus when asked, Delete… gets it back after Keep.
  const del = useRef<HTMLButtonElement>(null);
  const backToDelete = useRef(false);
  useEffect(() => {
    if (!ask && backToDelete.current) {
      backToDelete.current = false;
      del.current?.focus();
    }
  }, [ask]);
  const run = (action: FileAction) => {
    setAsk(false);
    runFileAction(action, session, open).then(
      (text) => {
        onNote(text);
        if (action === "delete") onDeleted();
      },
      (err) => {
        onNote(String(err));
        // T-722: a refused delete (the session is still open in a pane) hands the keyboard back to Delete….
        if (action === "delete") del.current?.focus();
      },
    );
  };
  if (ask) {
    return (
      <>
        <span className="sb-hint warn" role="alert">
          {deleteQuestion(session.title)}
          {heldByPane(open, session) && " It is open in a pane, so Kolux refuses the delete while that pane runs it."}
        </span>
        <button type="button" className="btn danger" onClick={() => run("delete")}>
          Delete
        </button>
        <button
          type="button"
          className="btn"
          autoFocus
          onClick={() => {
            backToDelete.current = true;
            setAsk(false);
          }}
        >
          Keep
        </button>
      </>
    );
  }
  return (
    <>
      <button type="button" className="btn" title="Show this session's file in the file manager" onClick={() => run("reveal")}>
        Show file
      </button>
      <button type="button" className="btn" title="Open this session's file in the program your system uses for it" onClick={() => run("open")}>
        Open file
      </button>
      <button ref={del} type="button" className="btn" title="Delete this session's files from this computer" onClick={() => setAsk(true)}>
        Delete…
      </button>
    </>
  );
}
