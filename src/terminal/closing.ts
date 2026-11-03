// TERM-045: closing a tab whose program is still running asks first; an idle shell closes at once.

/** Settings field: false turns the question off (Settings > Terminal & sessions). */
export const CONFIRM_CLOSE_FIELD = "confirmCloseRunning";

export const asksBeforeClose = (settings: Record<string, unknown>): boolean => settings[CONFIRM_CLOSE_FIELD] !== false;

/**
 * How many of `ids` would stop a live program if closed, and whether the check itself failed. A failed
 * check counts every id as busy (fails closed): closing asks rather than killing a program unseen.
 */
export async function busyCheck(ids: number[], check: (ids: number[]) => Promise<boolean[]>): Promise<{ busy: number; failed: boolean }> {
  if (ids.length === 0) return { busy: 0, failed: false };
  try {
    return { busy: (await check(ids)).filter(Boolean).length, failed: false };
  } catch {
    return { busy: ids.length, failed: true };
  }
}

/** The count half of busyCheck. */
export async function busyCount(ids: number[], check: (ids: number[]) => Promise<boolean[]>): Promise<number> {
  return (await busyCheck(ids, check)).busy;
}

/**
 * The question for closing the tab called `name`, with `busy` of its `panes` panes running a program.
 * `unsure`: the busy check failed, so the question says it could not tell instead of claiming a program runs.
 */
export function closeQuestion(name: string, busy: number, panes: number, unsure = false): { title: string; body: string } {
  const body = unsure
    ? panes <= 1
      ? "Kolux could not check whether a program is still running in it. Closing the tab may stop one."
      : `Kolux could not check whether programs are still running in its ${panes} panes. Closing the tab may stop them.`
    : panes <= 1
      ? "A program is still running in it. Closing the tab stops it."
      : `A program is still running in ${busy} of its ${panes} panes. Closing the tab stops them.`;
  return { title: `Close “${name}”?`, body };
}
