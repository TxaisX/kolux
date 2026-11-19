// EDIT-049 (T-317): the settings search filters after a short pause in typing, so fast typing never waits on
// the filter; an emptied box shows every setting again at once. `useSettled(query)` is the query to filter by.
import { useEffect, useState } from "react";

export const SETTLE_MS = 150;

/** How long to wait before `next` is the query to filter by: none when it is empty, else SETTLE_MS. */
export const settleDelay = (next: string): number => (next.trim() === "" ? 0 : SETTLE_MS);

export function useSettled(query: string, ms = SETTLE_MS): string {
  const [settled, setSettled] = useState(query);
  useEffect(() => {
    if (settleDelay(query) === 0) return void setSettled(query);
    const t = window.setTimeout(() => setSettled(query), ms);
    return () => window.clearTimeout(t);
  }, [query, ms]);
  return query.trim() === "" ? query : settled; // an emptied box never shows the old results for a render
}
