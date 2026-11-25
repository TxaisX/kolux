// The effort picker that stays in the message box (2026-11-24). It only exists for a model that offers
// levels: a model with none shows nothing here, not an empty list.
type Props = {
  efforts: readonly string[];
  /** The level chosen, or null for the model's own default. */
  value: string | null;
  disabled: boolean;
  onPick: (level: string) => void;
};

export function EffortPicker({ efforts, value, disabled, onPick }: Props) {
  if (efforts.length === 0) return null;
  const shown = value !== null && efforts.includes(value) ? value : "";
  return (
    <label className="wui-effort">
      <span className="wui-effort-word">Effort</span>
      <select aria-label="Effort" disabled={disabled} value={shown} onChange={(e) => e.currentTarget.value && onPick(e.currentTarget.value)}>
        {shown === "" && <option value="">Model default</option>}
        {efforts.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
