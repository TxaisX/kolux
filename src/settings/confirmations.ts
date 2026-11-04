// SET-043 (T-247-b): every confirmation that "don't ask again" can switch off, each remembered on its own,
// and the General card that brings them back. All four ask by default; a field set to false is skipped.
import { CONFIRM_DELETE_KEY } from "../automations/model";
import { CONFIRM_DELETE_FIELD } from "../projects/deleting";
import { CONFIRM_CLOSE_FIELD } from "../terminal/closing";
import { PIN_ASK_FIELD } from "../terminal/pin";

export type Skippable = { field: string; label: string };

export const SKIPPABLE: Skippable[] = [
  { field: CONFIRM_DELETE_FIELD, label: "deleting a workspace" },
  { field: PIN_ASK_FIELD, label: "closing a pinned tab" },
  { field: CONFIRM_DELETE_KEY, label: "deleting an automation" },
  { field: CONFIRM_CLOSE_FIELD, label: "closing a terminal that is running a program" },
];

/** The confirmations currently skipped. */
export const skippedOf = (s: Record<string, unknown>): Skippable[] => SKIPPABLE.filter((c) => s[c.field] === false);

/** The patch that makes the skipped ones ask again (only those; nothing else is written). */
export const askAgainPatch = (s: Record<string, unknown>): Record<string, boolean> => Object.fromEntries(skippedOf(s).map((c) => [c.field, true]));

/** The card's sentence: which questions are off, or that every one is asked. */
export function skippedSentence(s: Record<string, unknown>): string {
  const list = skippedOf(s).map((c) => c.label);
  if (list.length === 0) return "Every confirmation is asked.";
  const last = list.pop() as string;
  return `Not asking before ${list.length ? `${list.join(", ")} or ${last}` : last}.`;
}
