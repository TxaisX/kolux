// EDIT-031 (T-236-b): closing a new note that was never typed in removes the empty file Kolux made for it. The
// rule is closeGuard.unusedNotes; this runs it against the open buffers and sends the files to the trash (so
// even a wrong call is recoverable). App calls it with the tabs that are closing and the ones that stay.
import { invoke } from "@tauri-apps/api/core";
import { diskOf, textOf } from "./buffers";
import { unusedNotes, type GuardPane } from "./closeGuard";
import { isUntitled } from "./untitled";

/** `onFail` hears of a trash that did not go through (the empty file is then still on disk); without it the failure is logged. */
export function trashUnusedNotes(closing: GuardPane[], staying: GuardPane[], onFail?: (message: string) => void): void {
  const paths = unusedNotes(closing, staying, isUntitled, (p) => ({ text: textOf(p), disk: diskOf(p) }));
  if (!paths.length) return;
  void invoke("fs_trash", { paths }).catch((e) => {
    const message = `Kolux could not remove the empty note${paths.length === 1 ? "" : "s"} it made: ${e instanceof Error ? e.message : String(e)}`;
    if (onFail) onFail(message);
    else console.warn(message);
  });
}
