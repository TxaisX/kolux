import React, { useEffect } from 'react'
import type { CodexRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { findAvailableCodexAccount, isCodexQuotaExhausted } from './codex-account-transition'
import type { CodexStatusRuntimeTarget, CodexStatusSwitchGroup } from './status-bar-runtime-targets'

export function CodexAccountTransition({
  codex,
  accounts,
  group,
  usage,
  remoteOwned,
  open,
  busy,
  refreshUsage,
  selectAccount
}: {
  codex: ProviderRateLimits
  accounts: CodexRateLimitAccountsState
  group: CodexStatusSwitchGroup | undefined
  usage: readonly InactiveAccountUsage[]
  remoteOwned: boolean
  open: boolean
  busy: boolean
  refreshUsage: () => Promise<void>
  selectAccount: (id: string | null, target: CodexStatusRuntimeTarget) => Promise<void>
}): React.JSX.Element | null {
  const exhausted = isCodexQuotaExhausted(codex)
  const activeId = group?.targets.find((target) => target.active)?.id
  useEffect(() => {
    if (open && exhausted && !remoteOwned) {
      void refreshUsage()
    }
  }, [open, exhausted, remoteOwned, refreshUsage, activeId, group?.key])
  if (!exhausted) {
    return null
  }
  const findAvailable = () =>
    findAvailableCodexAccount({ codex, accounts, group, usage, remoteOwned })
  const next = findAvailable()

  return (
    <>
      <DropdownMenuLabel className="space-y-0.5">
        <div className="text-destructive">
          {translate('codex.accounts.quotaExhausted', 'This account has reached its Codex limit')}
        </div>
        <div className="text-[11px] font-normal text-muted-foreground">
          {translate(
            'codex.accounts.switchKeepsSessions',
            'Switch accounts for new sessions, then restart existing sessions when ready.'
          )}
        </div>
      </DropdownMenuLabel>
      {next ? (
        <DropdownMenuItem
          disabled={busy}
          onSelect={(event) => {
            event.preventDefault()
            const available = findAvailable()
            if (!busy && available) {
              void selectAccount(available.id, available.runtimeTarget)
            }
          }}
        >
          {translate('codex.accounts.switchAvailable', 'Switch to {{account}} — quota available', {
            account: next.label
          })}
        </DropdownMenuItem>
      ) : !remoteOwned ? (
        <DropdownMenuItem
          disabled={busy || usage.some((entry) => entry.isFetching)}
          onSelect={(event) => {
            event.preventDefault()
            void refreshUsage()
          }}
        >
          {translate('codex.accounts.checkAvailable', 'Check other accounts for available quota')}
        </DropdownMenuItem>
      ) : null}
    </>
  )
}
