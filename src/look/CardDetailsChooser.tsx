// PROJ-062 (T-266): the sidebar's "Card details" chooser: one tick-box per detail a workspace card
// can show. It saves ONE setting (the sidebar's onSetting writes one key per call); a set that equals
// a preset is saved as that preset's marker, so the card keeps following the preset (see cards.ts).
import { CARD_DETAILS, CARD_DETAILS_FIELD, detailsAfter, readCardDetails } from "./cards";

export function CardDetailsChooser({ settings, onSetting }: { settings: Record<string, unknown>; onSetting: (key: string, value: unknown) => void }) {
  const { shown } = readCardDetails(settings);
  return (
    <div role="group" aria-labelledby="card-details-head" className="card-details">
      <h3 id="card-details-head" className="sb-subhead">
        Card details
      </h3>
      {CARD_DETAILS.map((d) => (
        <label key={d.id} className="check">
          <input type="checkbox" aria-label={`card shows ${d.label.toLowerCase()}`} checked={shown.includes(d.id)} disabled={d.locked} title={d.locked ? "Always shown" : undefined} onChange={(e) => onSetting(CARD_DETAILS_FIELD, detailsAfter(settings, d.id, e.target.checked))} />
          {d.label}
        </label>
      ))}
    </div>
  );
}
