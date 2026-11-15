// TERM-110: what the terminal side reports comes out in plain words. A failure Kolux knows gets
// an explanation and what to do about it; one it cannot explain is shown as it came, with the
// link for reporting an issue kept. Local errors carry a short environment footer. There is no
// separate terminal host (DT-C27), so there is no dead-host case and no Restart-host button.
import { FEEDBACK_REPO } from "../settings/privacy";

const KNOWN: [RegExp, string][] = [
  // TERM-111: the Git Bash process limit, with the way out.
  [
    /resource temporarily unavailable|fork: retry|cannot allocate memory|too many processes/i,
    "Git Bash could not start another process: Windows has run out of process slots for it. Close a few terminals or other programs, or restart Kolux, then open the pane again.",
  ],
  [/os error 2\b|not found|cannot find the file|no such file/i, "Kolux can't find this program. Install it, or add its folder to PATH (the list of folders Windows looks in), then open the pane again."],
  [/os error 5\b|access is denied|permission denied/i, "Windows refused to start the program (access denied). An antivirus or a policy may be blocking it; allow it, then open the pane again."],
  [/is not running/i, "The program in this pane has ended, so nothing can be sent to it."],
];

/** True when Kolux has words of its own for this error. */
export const explained = (error: string): boolean => KNOWN.some(([re]) => re.test(error)) || /^(The folder|The drive|Kolux does not|No shell would start|This Claude pane)/.test(error);

/** The error in plain words; an unexplained one keeps its text and the issue link. `where` is the environment footer. */
export function explain(error: string, where = ""): string {
  const text = error.trim().replace(/^Error:\s*/i, "");
  const known = KNOWN.find(([re]) => re.test(text))?.[1];
  const footer = where ? ` (${where})` : "";
  if (known) return known + footer;
  if (explained(text)) return text + footer;
  return `${text}${footer}. If this keeps happening, report it: ${FEEDBACK_REPO}`;
}

/** TERM-111: the overlay's words for a shell that died with this exit code. */
export function exitAdvice(code: number): string {
  if (code === 127) return "A program it needed isn't installed (code 127). Restart tries again.";
  if (code === 126 || code === 128) return `It couldn't run its program (code ${code}). A wrong path or a blocked file is the usual cause. Restart tries again.`;
  if (code > 128) return `The program was stopped (code ${code}). Restart opens it again.`;
  return `It stopped by itself (code ${code}). Restart opens it again here. Close pane gives the space to the others.`;
}
