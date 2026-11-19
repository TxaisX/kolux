// The settings pages' reset button: it asks first in the shared Ask dialog before it resets.
import { useState } from "react";
import Ask from "../chrome/Ask";

/** A reset button that asks first in the shared Ask dialog; `yes` loses its "Yes, " and becomes the confirm word. */
export function ResetButton({ label, onReset, yes = "Yes, reset", keep = "Keep", ariaLabel, className = "btn", title }: { label: string; onReset: () => unknown; yes?: string; keep?: string; ariaLabel?: string; className?: string; title?: string }) {
  const [asking, setAsking] = useState(false);
  const word = yes.replace(/^Yes, (.)/, (_, c: string) => c.toUpperCase());
  return (
    <>
      <button type="button" className={className} title={title} data-reset aria-label={ariaLabel} onClick={() => setAsking(true)}>
        {label}
      </button>
      {asking && <Ask title={`${ariaLabel ?? label}?`} body={null} confirm={word} cancel={keep} onConfirm={() => (setAsking(false), onReset())} onCancel={() => setAsking(false)} />}
    </>
  );
}
