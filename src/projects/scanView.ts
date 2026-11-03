// PROJ-012 / PROJ-013: what the scan dialog shows. Events from the scan arrive one repository at a
// time; stopping keeps everything found so far selectable. Repositories that can be opened as
// projects start ticked; a bare repository is listed but cannot be ticked.
export type Found = { path: string; name: string; bare: boolean; linked: string | null };
export type ScanEvent = { scanId: number; found: Found | null; visited: number; count: number; done: boolean; stopped: boolean; limit: string | null };
export type ScanState = { scanId: number; found: Found[]; ticked: string[]; visited: number; running: boolean; stopped: boolean; limit: string | null };

export const begin = (scanId: number): ScanState => ({ scanId, found: [], ticked: [], visited: 0, running: true, stopped: false, limit: null });

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Folds one event in; another scan's events, and a repository already listed, change nothing. */
export function take(s: ScanState, e: ScanEvent): ScanState {
  if (e.scanId !== s.scanId) return s;
  let { found, ticked } = s;
  if (e.found && !found.some((f) => same(f.path, e.found!.path))) {
    found = [...found, e.found];
    if (!e.found.bare) ticked = [...ticked, e.found.path];
  }
  return { ...s, found, ticked, visited: Math.max(s.visited, e.visited), running: !e.done && s.running, stopped: s.stopped || e.stopped, limit: e.done ? e.limit : s.limit };
}

/** The user stopped the scan: nothing found is dropped. */
export const stopNow = (s: ScanState): ScanState => ({ ...s, running: false, stopped: true });

export const toggle = (s: ScanState, path: string): ScanState => {
  const f = s.found.find((x) => x.path === path);
  if (!f || f.bare) return s;
  return { ...s, ticked: s.ticked.includes(path) ? s.ticked.filter((p) => p !== path) : [...s.ticked, path] };
};

export const setAll = (s: ScanState, on: boolean): ScanState => ({ ...s, ticked: on ? s.found.filter((f) => !f.bare).map((f) => f.path) : [] });

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summary(s: ScanState): string {
  const base = `${plural(s.found.length, "repository", "repositories")} in ${plural(s.visited, "folder", "folders")}`;
  if (s.running) return `Looking: ${base} so far`;
  const why = s.limit === "depth" ? " Deeper folders were not looked at." : s.limit === "folders" ? " It stopped at the folder limit." : s.limit === "repositories" ? " It stopped at the repository limit." : "";
  return s.stopped && s.limit === null ? `Stopped: ${base}; what was found is still yours to pick` : `Done: ${base}.${why}`;
}

/** What Import will do, in words. */
export function importLine(s: ScanState, grouped: boolean): string {
  const n = s.ticked.length;
  if (n === 0) return "Nothing is ticked.";
  return `${plural(n, "repository", "repositories")} will be added ${grouped ? "as one group" : "as separate projects"}.`;
}

/** The scan to stop when the dialog goes away: only one that is still running. */
export const scanToStop = (s: ScanState | null): number | null => (s?.running ? s.scanId : null);
