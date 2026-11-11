// Settings pages load the first time they are opened (SET-006), so Settings itself opens quickly. So a click on a
// page finds its code already read, the other pages are read in the background once Settings has drawn (one page
// per idle moment, so the page just opened is never held up by ten others arriving at once), and a page's code is
// read as soon as the pointer or the keyboard reaches its button on the rail.
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
 *  code, one page per idle moment (the next is asked for once the one before has arrived), and returns its cancel.
 *  A loader that fails is left for the click to try again. */
export function pageWarmer<K extends string>(code: Partial<Record<K, Loader[]>>) {
  const asked = new Set<Loader>();
  const page = (id: K): Promise<unknown> => {
    const reads: Promise<unknown>[] = [];
    for (const load of code[id] ?? []) {
      if (asked.has(load)) continue;
      asked.add(load);
      reads.push(load().catch(() => asked.delete(load)));
    }
    return Promise.all(reads);
  };
  return {
    page: (id: K): void => void page(id),
    rest: (later: Later = idleLater) => {
      const todo = Object.keys(code) as K[];
      let cancel = () => {};
      let stopped = false;
      const next = () => {
        cancel = later(() => {
          const id = todo.shift();
          if (id === undefined || stopped) return;
          void page(id).then(() => {
            if (!stopped && todo.length > 0) next();
          });
        });
      };
      next();
      return () => {
        stopped = true;
        cancel();
      };
    },
  };
}
