// UX audit (browser pane): toolbar tooltips name the chord the keymap really holds for the action, so a customised
// binding is shown as it is and an unbound action shows no chord at all.
import { type Keymap, labelOf } from "../keys/keymap";

/** "Back (Alt+Left)": the name, and the action's first chord when it has one. */
export function withChord(name: string, map: Keymap, id: string): string {
  const parts = labelOf(map, id);
  return parts.length ? `${name} (${parts.join("+")})` : name;
}

/** What closing a tab would lose, in one line, or null when nothing is at stake. */
export function closeWarning(downloadsRunning: boolean, unsentNotes: number): string | null {
  const lost = [downloadsRunning ? "a download still running" : "", unsentNotes > 0 ? `${unsentNotes} note${unsentNotes === 1 ? "" : "s"} not sent` : ""].filter(Boolean);
  return lost.length ? `This tab has ${lost.join(" and ")}. Closing it drops ${lost.length > 1 ? "them" : "it"}; press Close again to go ahead.` : null;
}
