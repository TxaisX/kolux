// T-548 (OD-11): the quick account switcher. A small pill in the top bar (beside the usage pill)
// names the account new Claude and Codex panes use; clicking it opens a menu with every managed
// account of each provider, and a click makes that one the account for NEW panes. Panes already
// running keep their account (ACCT-017) until the person accepts the prompt that offers to move a Codex
// pane (ACCT-023). It hides itself until a provider has a managed account,
// and the accounts themselves are still added, signed in again and removed in Settings.
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { activeOf, buttonText, groupsOf, pickAccount, watchEscape, type ClaudeSwitchView, type CodexSwitchView, type Group, type Provider } from "./accounts";
import "./switcher.css";

/** Both views, re-read when either provider's accounts change; the same events Settings listens to. */
export function useAccountSwitcher(): { groups: Group[]; active: { claude: string | null; codex: string | null }; stale: boolean; pick: (provider: Provider, id: string | null) => Promise<string | null> } {
  const [claude, setClaude] = useState<ClaudeSwitchView | null>(null);
  const [codex, setCodex] = useState<CodexSwitchView | null>(null);
  // T-736: a failed read keeps the last view (the pill used to vanish) and marks it stale until a read succeeds.
  const [stale, setStale] = useState(false);
  const read = useCallback(() => {
    // A rejected one does not stop the other's setter: each `then` runs on its own.
    Promise.all([invoke<ClaudeSwitchView>("claude_accounts").then(setClaude), invoke<CodexSwitchView>("codex_accounts").then(setCodex)]).then(
      () => setStale(false),
      () => setStale(true),
    );
  }, []);
  useEffect(() => {
    read();
    const stops: Array<() => void> = [];
    let gone = false;
    for (const event of ["claude-accounts", "codex-accounts"]) {
      listen(event, read)
        .then((un) => (gone ? un() : stops.push(un)))
        .catch(() => {});
    }
    return () => {
      gone = true;
      stops.forEach((s) => s());
    };
  }, [read]);
  // One list per change of the views, so the Board and Tower memos keyed on it do not run on every render.
  const groups = useMemo(() => groupsOf(claude, codex), [claude, codex]);
  const pick = useCallback(
    async (provider: Provider, id: string | null) => {
      const group = groups.find((g) => g.provider === provider);
      if (!group) return null;
      try {
        await pickAccount((command, args) => invoke(command, args), group, id);
        return null;
      } catch (e) {
        return String(e);
      } finally {
        read();
      }
    },
    [groups, read],
  );
  // FIX-1: read against the listed accounts, so a stale id is the system default here as in the pill.
  const { claude: claudeActive, codex: codexActive } = activeOf(claude, codex);
  // One object per change, so a memo or an effect keyed on it does not run on every render.
  const active = useMemo(() => ({ claude: claudeActive, codex: codexActive }), [claudeActive, codexActive]);
  return { groups, active, stale, pick };
}

type ViewProps = { groups: Group[]; open: { top: number; left: number } | null; error?: string | null; onOpen: (at: { top: number; left: number }) => void; onClose: () => void; onPick: (provider: Provider, id: string | null) => void };

export function AccountSwitcherView({ groups, open, error = null, onOpen, onClose, onPick }: ViewProps) {
  if (groups.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="acct-switch"
        title="Choose the account new panes use"
        aria-haspopup="menu"
        aria-expanded={open !== null}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onOpen({ top: r.bottom + 4, left: Math.max(8, r.right - 260) });
        }}
      >
        <span className="acct-switch-text">{buttonText(groups)}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          {/* T-620: the menu is drawn inside the top bar's drag region; "false" keeps clicks on it from moving the window. */}
          <div className="menu-backdrop" onClick={onClose} aria-hidden="true" data-tauri-drag-region="false" />
          <EscapeWatch onClose={onClose} />
          <div className="menu acct-menu" role="menu" aria-label="Accounts for new panes" style={open} data-tauri-drag-region="false">
            {groups.map((g) => (
              <div key={g.provider} role="group" aria-label={`${g.name} accounts`}>
                <div className="menu-title">{g.name}</div>
                {g.choices.map((c) => (
                  <button key={c.id ?? "default"} role="menuitemradio" aria-checked={c.active} className="menu-item" disabled={g.busy} autoFocus={c.active} title={c.active ? `New ${g.name} panes use this account` : `Use this account for new ${g.name} panes`} onClick={() => (c.active ? onClose() : onPick(g.provider, c.id))}>
                    <span className="name">{c.label}</span>
                    {c.trouble && <span className="acct-trouble">{c.trouble}</span>}
                    <span className="acct-check" aria-hidden="true">{c.active ? "✓" : ""}</span>
                  </button>
                ))}
                {g.busy && <div className="menu-hint">A sign-in is running. Finish or cancel it in Settings first.</div>}
                {g.note && <div className="menu-hint">{g.note}</div>}
              </div>
            ))}
            <div className="menu-hint">Panes already running keep their account, until you accept the prompt to move one.</div>
            {error && (
              <div className="menu-hint acct-error" role="alert">
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** The top-bar mount: `<AccountSwitcher />` in the right-hand group, before the usage pill. */
export default function AccountSwitcher() {
  const { groups, stale, pick } = useAccountSwitcher();
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  return (
    <AccountSwitcherView
      groups={groups}
      open={open}
      error={error ?? (stale ? "Accounts didn't load; list may be old." : null)}
      onOpen={(at) => (setError(null), setOpen(at))}
      onClose={close}
      onPick={(provider, id) =>
        void pick(provider, id).then((failed) => {
          setError(failed);
          if (!failed) setOpen(null);
        })
      }
    />
  );
}

/** FIX-1/FIX-2: while the menu is open (this component is only mounted then), Escape closes it wherever
 *  focus is and stops there, so a focused terminal or agent pane never sees it. The old handler sat on
 *  the menu and only fired with focus inside it; with every row disabled (a sign-in running) nothing took focus. */
export function EscapeWatch({ onClose }: { onClose: () => void }) {
  useEffect(() => watchEscape(window, onClose), [onClose]);
  return null;
}
