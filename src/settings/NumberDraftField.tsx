// SET-036: a whole-number box that keeps what was typed, so 3000 can be entered digit by digit; a pause
// saves a finished number that is in range, and leaving the box clamps and saves what is there. The typed
// text resolves to the stored one, so a clamped value shows as stored (typed "5", the box shows "200").
// Audit N-47: the editor's auto-save delay and the agent sleep minutes were two copies of this.
import { useDraft } from "./useDraft";

export function NumberDraftField({
  value,
  parse,
  onSave,
  label,
  min,
  max,
  step,
}: {
  value: number;
  /** The number the text names, or null when it is empty or unreadable. */
  parse: (text: string) => number | null;
  onSave: (v: number) => Promise<boolean>;
  label: string;
  min: number;
  max: number;
  step: number;
}) {
  const { props, draft } = useDraft(
    String(value),
    async (text) => {
      const v = parse(text);
      if (v === null) return false;
      return v === value || (await onSave(v)) !== false ? String(v) : false;
    },
    (text) => String(parse(text)) === text, // in range and in normal form: nothing for the box to rewrite
  );
  // An empty or unreadable box goes back to the saved number when the user leaves it.
  const onBlur = async () => {
    await draft.leave();
    if (parse(draft.state().text) === null) draft.discard();
  };
  return <input className="field" type="number" aria-label={label} min={min} max={max} step={step} {...props} onBlur={onBlur} />;
}
