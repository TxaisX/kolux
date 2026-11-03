// One row of an accounts list (ACCT-016, ACCT-019): clicking the row makes it the account new
// panes use; managed rows offer re-authenticate and a Remove that asks first, inline, because the
// webview has no confirm dialog. The System default row stands for the CLI's own login.
import type { ReactNode } from "react";
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
  const stop = (f: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    f();
  };
  return (
    <div className="acct-entry">
      <div
        className="acct-row"
        data-active={active}
        role="button"
        tabIndex={0}
        aria-pressed={active}
        title={active ? "New panes use this account" : "Use this account for new panes"}
        onClick={pick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            pick();
          }
        }}
      >
        <div className="acct-who">
          <span className="acct-email">{title}</span>
          <span className="acct-org">{detail}</span>
        </div>
        {trouble && <span className="conn-chip attention">{trouble}</span>}
        {active && <span className="conn-chip connected">Active</span>}
        {manage && (
          <div className="btn-row">
            {manage.againLabel && (
              <button className="btn" disabled={busy} onClick={stop(manage.onAgain)}>
                {manage.againLabel}
              </button>
            )}
            {manage.onName && (
              <button className="btn" disabled={busy} onClick={stop(manage.onName)}>
                {manage.nameLabel}
              </button>
            )}
            <button className="btn" disabled={busy} onClick={stop(manage.onAsk)}>
              Remove
            </button>
          </div>
        )}
      </div>
      {manage?.confirming && (
        <div className="acct-confirm" role="alertdialog" aria-label={`Remove ${title}?`}>
          <span>{`Remove ${title}? Its sign-in is deleted from Kolux${manage.activeGoes ? "; the System default takes over for new panes" : ""}. Panes already running keep going.`}</span>
          <div className="btn-row">
            <button className="btn danger" onClick={manage.onRemove}>
              Remove
            </button>
            <button className="btn" onClick={manage.onKeep}>
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
