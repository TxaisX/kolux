// UX audit D (ux7): the small pure rules the Checks tab pieces share, kept out of the components so they can be tested
// without a screen: why a reply is unavailable, a per-row pending/error book, the clipboard write that says whether
// it worked, the words for a link that would not open, and the pull request drafts kept per folder.

/** The tooltip and hint for a thread that cannot take a reply, or null when it can. */
export const replyBlock = (t: { comments: { db_id: number | null }[] }): string | null => (t.comments[0]?.db_id != null ? null : "GitHub gave no id for this thread's first comment, so it cannot be replied to here. Open the pull request to reply.");

/** One word for the same action everywhere: a failed check's jobs are rerun, a failed read is retried, a list is refreshed. */
export const RERUN = "Rerun failed jobs";
export const RETRY = "Retry";
export const REFRESH = "Refresh";

/** What a link that did not open says. */
export const openFailed = (err: unknown): string => `The page could not be opened: ${String(err)}`;

/** Which rows are mid-action, and the error each last stopped on. Immutable, so React state can hold it. */
export type RowBook = { pending: readonly string[]; errors: Readonly<Record<string, string>> };
export const emptyBook: RowBook = { pending: [], errors: {} };
export const rowStart = (b: RowBook, row: string): RowBook => {
  const { [row]: _gone, ...errors } = b.errors;
  return { pending: b.pending.includes(row) ? b.pending : [...b.pending, row], errors };
};
export const rowDone = (b: RowBook, row: string, error?: string): RowBook => ({ pending: b.pending.filter((r) => r !== row), errors: error ? { ...b.errors, [row]: error } : b.errors });
export const rowBusy = (b: RowBook, row: string): boolean => b.pending.includes(row);

/** Writes to the clipboard and says whether it worked; a page with no clipboard says no instead of doing nothing. */
export async function copyText(text: string, clip: Pick<Clipboard, "writeText"> | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard): Promise<boolean> {
  if (!clip) return false;
  try {
    await clip.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The pull request composer's text by folder. A folder's draft stays while another folder is open, and a closed-but-kept draft (Escape) reopens with its text. */
export type PrDraft = { title: string; body: string; base: string; draft: boolean };
export type DraftEntry = { draft: PrDraft; shown: boolean };
export type DraftBook = Map<string, DraftEntry>;
export const keepDraft = (book: DraftBook, dir: string, draft: PrDraft | null, shown = true): void => {
  if (draft === null) book.delete(dir);
  else book.set(dir, { draft, shown });
};
/** The draft to show when `dir` opens: the one that was open there, or null. */
export const shownDraft = (book: DraftBook, dir: string): PrDraft | null => {
  const e = book.get(dir);
  return e && e.shown ? e.draft : null;
};
/** Hides the folder's composer but keeps what was typed (Escape). */
export const hideDraft = (book: DraftBook, dir: string): void => {
  const e = book.get(dir);
  if (e) book.set(dir, { draft: e.draft, shown: false });
};
/** The text a reopened composer starts with: the kept draft, else `fresh`. */
export const startDraft = (book: DraftBook, dir: string, fresh: PrDraft): PrDraft => book.get(dir)?.draft ?? fresh;
