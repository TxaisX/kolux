// DT-C270: whether Go to / Run a command is open, kept outside the window's own state. It used to be a
// useState in the window's root, so opening the palette drew the whole window again (every hook and every
// surface that is not compared prop by prop), to change one flag that only the palette reads. Held here,
// opening it draws the palette and nothing else.
import { useSyncExternalStore } from "react";

let open = false;
const watchers = new Set<() => void>();
const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => void watchers.delete(w);
};

/** Opens or closes Go to / Run a command. */
export function setPaletteOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  watchers.forEach((w) => w());
}

/** Whether it is open now. */
export const paletteOpen = (): boolean => open;

/** Whether it is open, for the one surface that draws it. */
export function usePaletteOpen(): boolean {
  return useSyncExternalStore(subscribe, paletteOpen, paletteOpen);
}
