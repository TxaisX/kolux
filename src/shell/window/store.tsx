// Cycle 3 (the WindowView split): the window's drawing reads one store, not a page of props. App.tsx fills
// the bag once a render (shell/windowBag.ts) and hands it to the provider; each surface below asks for it
// with useWindow() and names the fields it reads. Those names are typed by WindowBag, so a field the window
// stops making fails `tsc` at the surface that still reads it.
import { createContext, useContext, type ReactNode } from "react";
import type { WindowBag } from "../windowBag";

/** T-745: read directly by the chooser, which also renders outside the window (tests, the sheet page). */
export const WindowStore = createContext<WindowBag | null>(null);

/** The window's one state container, held for the surfaces under it. Drawing only: it starts no work. */
export function WindowStoreProvider({ store, children }: { store: WindowBag; children: ReactNode }) {
  return <WindowStore.Provider value={store}>{children}</WindowStore.Provider>;
}

/** A surface's selector: the window's state and the actions it runs, typed. */
export function useWindow(): WindowBag {
  const w = useContext(WindowStore);
  if (w === null) throw new Error("useWindow is for the window's surfaces, under shell/WindowView.tsx");
  return w;
}
