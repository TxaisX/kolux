// START-06: the banner an agent pane shows when its program ended by itself with an error. It names
// the failure in plain words, repeats the program's last output line (colour and control sequences
// stripped), and offers the one way back: start the same agent again in this pane, without the resume
// arguments its first start line carried. A pane Kolux closed shows nothing: on Windows Kolux's own
// kill reports exit 1, so the code alone cannot tell the two ends apart (START-04 says the reason).
// Pure: the pane hands in the exit facts; the banner (or none) comes back.
export type ExitFacts = { reason: "closed" | "exited"; code: number | null; lastLine: string | null; resumed: boolean };
export type ExitBanner = { title: string; lastLine: string | null; action: "Start fresh" };

/** CSI (colour, cursor, erase) and OSC (a title, a hyperlink), the two a program's output carries. */
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
/** Every other control character: BEL, NUL, CR/LF and the rest up to U+001F, plus DEL. */
const CONTROL = /[\u0000-\u001f\u007f]/g;
const MAX_CHARS = 200;

/** The line a banner can show: cleaned, trimmed, and cut to 200 characters (199 and an ellipsis). */
function cleanLine(line: string | null): string | null {
  if (line === null) return null;
  const text = line.replace(OSC, "").replace(CSI, "").replace(CONTROL, "").trim();
  if (text === "") return null;
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text;
}

/** The banner an agent pane shows for these exit facts; null when the pane should stay quiet. */
export function exitBanner(f: ExitFacts): ExitBanner | null {
  if (f.reason === "closed" || f.code === null || f.code === 0) return null;
  const title = f.resumed ? `The saved conversation did not reopen (exit ${String(f.code)})` : `The program stopped with an error (exit ${String(f.code)})`;
  return { title, lastLine: cleanLine(f.lastLine), action: "Start fresh" };
}
