// A second click on Resume / Resume as chat while the first is still being set up must not open a
// second terminal. `start` says whether the caller may go ahead; `done` lets the next click through
// a moment after (so a double click is still one, even when the plan comes back instantly).
export const SETTLE_MS = 700;

export class InFlight {
  private held = new Set<string>();
  constructor(private later: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms)) {}
  start(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }
  done(key: string): void {
    this.later(() => void this.held.delete(key), SETTLE_MS);
  }
}
