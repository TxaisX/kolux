import type { CodexRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type {
  InactiveAccountUsage,
  ProviderRateLimits,
  RateLimitWindow
} from '../../../../shared/rate-limit-types'
import { normalizeCodexAccountEmail } from '@/lib/codex-account-display-label'
import type { CodexStatusSwitchGroup, CodexStatusSwitchTarget } from './status-bar-runtime-targets'

const USAGE_FRESHNESS_MS = 5 * 60_000

function isFreshUsage(
  limits: ProviderRateLimits | null,
  now: number
): limits is ProviderRateLimits {
  return Boolean(
    limits?.provider === 'codex' &&
    limits.status === 'ok' &&
    !limits.error &&
    !limits.usageMetadata?.failureKind &&
    limits.updatedAt > 0 &&
    limits.updatedAt <= now &&
    now - limits.updatedAt <= USAGE_FRESHNESS_MS
  )
}

function isCurrentWindow(window: RateLimitWindow | null, now: number): window is RateLimitWindow {
  return Boolean(
    window &&
    Number.isFinite(window.usedPercent) &&
    window.usedPercent >= 0 &&
    (window.resetsAt === null || window.resetsAt > now)
  )
}

export function isCodexQuotaExhausted(limits: ProviderRateLimits, now = Date.now()): boolean {
  return (
    isFreshUsage(limits, now) &&
    [limits.session, limits.weekly].some(
      (window) => isCurrentWindow(window, now) && window.usedPercent >= 100
    )
  )
}

export function findAvailableCodexAccount({
  codex,
  accounts,
  group,
  usage,
  remoteOwned,
  now = Date.now()
}: {
  codex: ProviderRateLimits
  accounts: CodexRateLimitAccountsState
  group: CodexStatusSwitchGroup | undefined
  usage: readonly InactiveAccountUsage[]
  remoteOwned: boolean
  now?: number
}): CodexStatusSwitchTarget | null {
  // Inactive previews belong to the desktop; they cannot establish remote quota.
  if (remoteOwned || !group || !isCodexQuotaExhausted(codex, now)) {
    return null
  }
  const activeId = group.targets.find((target) => target.active)?.id
  const current = accounts.accounts.find((account) => account.id === activeId)
  const identity =
    current ?? (group.runtimeTarget.runtime === 'host' ? accounts.systemDefault : null)
  if (!identity) {
    return null
  }

  return (
    group.targets.find((target) => {
      if (target.active || !target.id) {
        return false
      }
      const candidate = accounts.accounts.find((account) => account.id === target.id)
      if (!candidate) {
        return false
      }
      const currentProviderId = identity.providerAccountId?.trim()
      const candidateProviderId = candidate.providerAccountId?.trim()
      const sameProvider = currentProviderId && currentProviderId === candidateProviderId
      const sameEmail =
        normalizeCodexAccountEmail(identity.email) === normalizeCodexAccountEmail(candidate.email)
      if (sameProvider || ((!currentProviderId || !candidateProviderId) && sameEmail)) {
        return false
      }
      // Unknown identities cannot prove that switching buys a separate quota.
      if (!currentProviderId && !normalizeCodexAccountEmail(identity.email)) {
        return false
      }
      if (!candidateProviderId && !normalizeCodexAccountEmail(candidate.email)) {
        return false
      }
      const preview = usage.find((entry) => entry.accountId === target.id)
      const limits = preview?.rateLimits ?? null
      if (preview?.isFetching || !isFreshUsage(limits, now)) {
        return false
      }
      return [limits.session, limits.weekly].every(
        (window) => isCurrentWindow(window, now) && window.usedPercent < 100
      )
    }) ?? null
  )
}
