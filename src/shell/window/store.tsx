// Cycle 3 (the WindowView split): the window's drawing reads one store, not a page of props. App.tsx fills
// the bag once a render (shell/windowBag.ts) and hands it to the provider; each surface below asks for it
// with useWindow() and names the fields it reads. Those names are typed by WindowBag, so a field the window
// stops making fails `tsc` at the surface that still reads it.
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { WindowBag } from "../windowBag";
import { callers, type Callers } from "./stable";

/** T-745: read directly by the chooser, which also renders outside the window (tests, the sheet page). */
export const WindowStore = createContext<WindowBag | null>(null);

/** PKG-2: the bag's functions as callers that keep one identity for the window's life (stable.ts). */
const WindowDeeds = createContext<Callers<WindowBag> | null>(null);

/** The window's one state container, held for the surfaces under it. Drawing only: it starts no work. */
export function WindowStoreProvider({ store, children }: { store: WindowBag; children: ReactNode }) {
  // The newest bag, written during render (the same bag for both StrictMode passes); a deed reads it when called.
  const latest = useRef(store);
  latest.current = store;
  const [deeds] = useState(() => callers(() => latest.current));
  return (
    <WindowDeeds.Provider value={deeds}>
      <WindowStore.Provider value={store}>{children}</WindowStore.Provider>
    </WindowDeeds.Provider>
  );
}

/** A surface's selector: the window's state and the actions it runs, typed. */
export function useWindow(): WindowBag {
  const w = useContext(WindowStore);
  if (w === null) throw new Error("useWindow is for the window's surfaces, under shell/WindowView.tsx");
  return w;
}

/** PKG-2: the window's actions with a fixed identity, each running the newest render's function. Only for a child
 *  that calls them from an event handler or an effect: a selector a child calls while it draws (statusOf, tabName,
 *  chipFor) must be handed over as it is, or as the value it returns, never as a deed. */
export function useDeeds(): Callers<WindowBag> {
  const d = useContext(WindowDeeds);
  if (d === null) throw new Error("useDeeds is for the window's surfaces, under shell/WindowView.tsx");
  return d;
}
