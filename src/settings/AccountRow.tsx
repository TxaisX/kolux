// One row of an accounts list (ACCT-016, ACCT-019): clicking the row makes it the account new
// panes use; managed rows offer re-authenticate and a Remove that asks first, in the shared Ask dialog.
// The System default row stands for the CLI's own login.
import type { ReactNode } from "react";
import Ask from "../chrome/Ask";
import { locale } from "../language";

export const signedInAt = (ms: number) => new Date(ms).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });

type Props = {
  title: string;
  detail: ReactNode;
  active: boolean;
  busy: boolean;
  onPick: () => void;
  trouble?: string | null;
  /** Managed rows only. */
  manage?: { againLabel: string | null; onAgain: () => void; confirming: boolean; activeGoes: boolean; onAsk: () => void; onRemove: () => void; onKeep: () => void; nameLabel?: string; onName?: () => void };
  /** Shown under the row, e.g. a name field. */
  below?: ReactNode;
};

export function AccountRow({ title, detail, active, busy, onPick, trouble, manage, below }: Props) {
  const pick = () => {
    if (!active && !busy) onPick();
  };
  return (
    <div className="acct-entry">
      {/* T-712: the pick control and the row's own buttons sit side by side; none is nested in another. */}
      <div className="acct-row" data-active={active}>
        <button
          type="button"
          className="acct-pick"
          aria-pressed={active}
          title={active ? "New panes use this account" : "Use this account for new panes"}
          onClick={pick}
        >
          <span className="acct-who">
            <span className="acct-email">{title}</span>
            <span className="acct-org">{detail}</span>
          </span>
          {trouble && <span className="conn-chip attention">{trouble}</span>}
          {active && <span className="conn-chip connected">Active</span>}
        </button>
        {manage && (
          <div className="btn-row">
            {manage.againLabel && (
              <button className="btn" disabled={busy} onClick={manage.onAgain}>
                {manage.againLabel}
              </button>
            )}
            {manage.onName && (
              <button className="btn" disabled={busy} onClick={manage.onName}>
                {manage.nameLabel}
              </button>
            )}
            <button className="btn" disabled={busy} onClick={manage.onAsk}>
              Remove
            </button>
          </div>
        )}
      </div>
      {manage?.confirming && (
        // T-712 (DT-C148): the shared Ask opens on Keep, and Escape means Keep (not closing Settings).
        <Ask
          title={`Remove ${title}?`}
          body={`Its sign-in is deleted from Kolux${manage.activeGoes ? "; the System default takes over for new panes" : ""}. Its settings, project trust and transcripts stay on this PC. Panes already running keep going.`}
          confirm="Remove"
          cancel="Keep"
          onConfirm={() => !busy && manage.onRemove()}
          onCancel={manage.onKeep}
        />
      )}
      {below}
    </div>
  );
}

/** The accounts list could not be read at all: say so and offer Retry, instead of drawing nothing. */
export function AccountsReadError({ name, error, onRetry }: { name: string; error: string; onRetry: () => void }) {
  return (
    <section className="conn-card" aria-label={`${name} accounts`}>
      <span className="conn-name">{name} accounts</span>
      <p className="conn-detail warn" role="alert">
        The list could not be read: {error}
      </p>
      <button type="button" className="btn" onClick={onRetry}>
        Retry
      </button>
    </section>
  );
}
