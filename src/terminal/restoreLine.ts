/** Txais (2026-11-21): how long a restored tab waits for its own start line before mounting without
 *  one. Review P1-B (2026-11-23): a slow agent's lookup takes about 3 s per ask, and a miss mounts the
 *  tab on its bare line with no resume, so the wait is well past that. A wedged ask still never holds
 *  the window forever. */
export const RESTORE_ASK_MS = 15_000;

/** Races `ask` against a deadline of `ms`. A late answer is a miss: `onMiss` runs once and the result
 *  is null. A refused ask is null too, but not a miss (it answered, with no line). */
export function within<T>(ask: Promise<T>, ms: number, onMiss: () => void): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const late = setTimeout(() => (onMiss(), resolve(null)), ms);
    ask.then(
      (value) => (clearTimeout(late), resolve(value)),
      () => (clearTimeout(late), resolve(null)),
    );
  });
}
