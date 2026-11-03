// UX lane A (shell.md row 12): a restored tab of a special kind (editor, diff, preview, changes, check) that lost the
// file or folder it was showing used to fall through to a live terminal. It keeps its kind and says what happened.
import type { Pane } from "../../App";

const WHAT: Record<NonNullable<Pane["kind"]>, string> = {
  browser: "browser page",
  editor: "file",
  diff: "diff",
  changes: "changes view",
  check: "check",
  preview: "preview",
};

export type LostWords = { title: string; body: string; close: string };

/** The words for a tab whose kind is set but whose data is gone. */
export function lostWords(kind: NonNullable<Pane["kind"]>): LostWords {
  return {
    title: `This ${WHAT[kind]} tab has nothing to show`,
    body: `The ${WHAT[kind]} it was showing could not be found, so Kolux did not start a terminal in its place. Close this tab and open it again.`,
    close: "Close tab",
  };
}
