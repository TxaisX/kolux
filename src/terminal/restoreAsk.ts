// C24-R1-01: a tab that came back from the saved layout and could not take its terminal back is not
// a session that failed to start. SESS-024 drops a pane whose session never ran; here the tab has
// content (its saved output is already replayed) and a saved transcript on disk, so dropping it would
// rewrite the layout without its key and the next start would prune that transcript. The tab keeps
// its place, says why, and offers Try again. A fresh tab with no terminal to take back still drops.
import type { Reattached } from "./reattach";

/** Whether a reattach answer keeps the tab instead of failing the pane. */
export const keepsTab = (back: Reattached, restored: boolean): boolean => restored && (back.kind === "timeout" || back.kind === "refused");
