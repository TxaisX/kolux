// One row of an accounts list (ACCT-016, ACCT-019): clicking the row makes it the account new
// panes use; managed rows offer re-authenticate and a Remove that asks first, inline, because the
// webview has no confirm dialog. The System default row stands for the CLI's own login.
import { useEffect, useRef, type ReactNode } from "react";
import { locale } from "../language";
import { watchEscape } from "../switcher/accounts";

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
  // T-712 (DT-C148): while the Remove confirm is up and nothing is running, Escape means Keep.
  const keep = useRef(manage?.onKeep);
  keep.current = manage?.onKeep;
  const asking = !!manage?.confirming && !busy;
  useEffect(() => (asking ? watchEscape(document, () => keep.current?.()) : undefined), [asking]);
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
        <div className="acct-confirm" role="alertdialog" aria-label={`Remove ${title}?`}>
          <span>{`Remove ${title}? Its sign-in is deleted from Kolux${manage.activeGoes ? "; the System default takes over for new panes" : ""}. Panes already running keep going.`}</span>
          <div className="btn-row">
            <button className="btn danger" disabled={busy} onClick={manage.onRemove}>
              Remove
            </button>
            <button className="btn" disabled={busy} onClick={manage.onKeep}>
              Keep
            </button>
          </div>
        </div>
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
