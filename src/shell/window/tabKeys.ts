// UX lane A (keyboard.md row 2, shell.md row 5): the tab strip is a tablist, so it is one tab stop and the
// arrows move along it. Roving tabindex: only the front tab is in the Tab order; Left and Right move to the
// neighbour (wrapping), Home and End to the ends. Focus moves without bringing the tab forward (manual activation):
// a tab brought forward hands the keyboard to its pane. Enter and Space bring the focused tab forward. The close
// buttons stay out of the Tab order (the tab menu and the shortcut close a tab).

/** The tabindex of the tab for pane `key`: the front tab is the one stop, the rest are reached by arrows. If the
 *  front pane is not in this strip (nothing to land on), the first tab is the stop so the strip is never skipped. */
export function tabStop(key: number, active: number, order: number[]): 0 | -1 {
  const front = order.includes(active) ? active : order[0];
  return key === front ? 0 : -1;
}

/** The pane to move to after `keyName` with tab `at` focused (strip `order`), or null when the key is not a tab key. */
export function tabKeyTarget(keyName: string, order: number[], at: number): number | null {
  const i = order.indexOf(at);
  if (i < 0 || order.length === 0) return null;
  if (keyName === "Home") return order[0];
  if (keyName === "End") return order[order.length - 1];
  if (keyName === "ArrowRight") return order[(i + 1) % order.length];
  if (keyName === "ArrowLeft") return order[(i - 1 + order.length) % order.length];
  return null;
}

/** What a key on a tab does. `focus` only moves focus; `activate` brings the focused tab forward. */
export function tabKeyAction(keyName: string, order: number[], at: number): { focus: number } | { activate: number } | null {
  if (keyName === "Enter" || keyName === " ") return order.includes(at) ? { activate: at } : null;
  const to = tabKeyTarget(keyName, order, at);
  return to === null ? null : { focus: to };
}
