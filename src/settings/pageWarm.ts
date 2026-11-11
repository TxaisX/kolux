// Settings pages load the first time they are opened (SET-006), so Settings itself opens quickly. So a click on a
// page finds its code already read, the other pages are read in the background once Settings has drawn (at the first
// idle moment), and a page's code is read as soon as the pointer or the keyboard reaches its button on the rail.
// Each page's code is asked for once; the module only names the loaders SettingsPage hands it, so nothing here
// reaches the window's first load.

export type Loader = () => Promise<unknown>;
/** Runs `f` when the window is idle: requestIdleCallback where there is one, else a short timeout. */
export type Later = (f: () => void) => () => void;

export const idleLater: Later = (f) => {
  const w = typeof window !== "undefined" ? (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }) : undefined;
  if (w?.requestIdleCallback) {
    const id = w.requestIdleCallback(f, { timeout: 2000 });
    return () => w.cancelIdleCallback?.(id);
  }
  const t = setTimeout(f, 300);
  return () => clearTimeout(t);
};

/** The warm-up for a set of pages' loaders. `page(id)` reads one page's code now; `rest(later)` reads every page's
 *  code at the next idle moment and returns its cancel. A loader that fails is left for the click to try again. */
export function pageWarmer<K extends string>(code: Partial<Record<K, Loader[]>>) {
  const asked = new Set<Loader>();
  const page = (id: K) => {
    for (const load of code[id] ?? []) {
      if (asked.has(load)) continue;
      asked.add(load);
      load().catch(() => asked.delete(load));
    }
  };
  return {
    page,
    rest: (later: Later = idleLater) => later(() => (Object.keys(code) as K[]).forEach(page)),
  };
}
