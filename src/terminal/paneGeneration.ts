// C26-R3-01: a pane reaps its terminal when it unmounts. That is right for a tab the user closed, and wrong for a
// tree the window's root replaces: the terminal belongs to the next drawing's pane of the same key (APP-052), so
// reaping it there kills an agent nobody closed. A pane stamps the generation it mounted in and reaps only while
// that is still the current one. main.tsx draws one App for the window's life, so the settings path never bumps
// this; `nextGeneration` is the one line a future re-draw has to call first.
export const windowGeneration = { current: 1 };

/** The root is about to draw a different tree: the panes of the old one hand their terminals to the next. */
export function nextGeneration(): number {
  return ++windowGeneration.current;
}

/** Whether a pane mounted in generation `mountedIn` may reap its terminal when it unmounts. */
export const killsOnUnmount = (mountedIn: number) => mountedIn === windowGeneration.current;
