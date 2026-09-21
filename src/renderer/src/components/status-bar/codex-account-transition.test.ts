import { describe, expect, it } from 'vitest'
import type { CodexRateLimitAccountsState } from '../../../../shared/managed-account-types'
import type { InactiveAccountUsage, ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { findAvailableCodexAccount, isCodexQuotaExhausted } from './codex-account-transition'
import type { CodexStatusSwitchGroup } from './status-bar-runtime-targets'

const now = 1_000_000
const target = { runtime: 'host' as const, wslDistro: null }
function limits(session = 10, weekly = 20): ProviderRateLimits {
  return {
    provider: 'codex',
    status: 'ok',
    error: null,
    updatedAt: now,
    session: {
      usedPercent: session,
      windowMinutes: 300,
      resetsAt: now + 60_000,
      resetDescription: null
    },
    weekly: {
      usedPercent: weekly,
      windowMinutes: 10080,
      resetsAt: now + 60_000,
      resetDescription: null
    }
  }
}
function fixture() {
  const accounts: CodexRateLimitAccountsState = {
    activeAccountId: 'a',
    accounts: ['a', 'b', 'c'].map((id) => ({
      id,
      email: `${id}@example.com`,
      providerAccountId: `provider-${id}`,
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    }))
  }
  const group: CodexStatusSwitchGroup = {
    key: 'host',
    label: 'This device',
    runtimeTarget: target,
    targets: accounts.accounts.map((account) => ({
      id: account.id,
      label: account.email,
      active: account.id === 'a',
      runtimeTarget: target
    }))
  }
  const usage: InactiveAccountUsage[] = ['b', 'c'].map((accountId) => ({
    accountId,
    rateLimits: limits(),
    updatedAt: now,
    isFetching: false
  }))
  return { codex: limits(100), accounts, group, usage, remoteOwned: false, now }
}

describe('Codex quota transition', () => {
  it('offers the next known available account for either exhausted window', () => {
    const args = fixture()
    expect(findAvailableCodexAccount(args)?.id).toBe('b')
    args.codex = limits(10, 100)
    expect(findAvailableCodexAccount(args)?.id).toBe('b')
  })

  it.each([
    'stale',
    'fetching',
    'unavailable',
    'depleted',
    'unknown-weekly',
    'reset-passed',
    'invalid',
    'failed-metadata'
  ])('skips %s quota and continues to the next usable account', (kind) => {
    const args = fixture()
    const preview = args.usage[0]
    const quota = preview.rateLimits!
    if (kind === 'stale') {
      quota.updatedAt = now - 300_001
    }
    if (kind === 'fetching') {
      preview.isFetching = true
    }
    if (kind === 'unavailable') {
      quota.status = 'unavailable'
    }
    if (kind === 'depleted') {
      quota.weekly!.usedPercent = 100
    }
    if (kind === 'unknown-weekly') {
      quota.weekly = null
    }
    if (kind === 'reset-passed') {
      quota.session!.resetsAt = now - 1
    }
    if (kind === 'invalid') {
      quota.session!.usedPercent = Number.NaN
    }
    if (kind === 'failed-metadata') {
      quota.usageMetadata = { failureKind: 'network' }
    }
    expect(findAvailableCodexAccount(args)?.id).toBe('c')
  })

  it('skips duplicate provider identities even when email differs', () => {
    const args = fixture()
    args.accounts.accounts[1].providerAccountId = 'provider-a'
    expect(findAvailableCodexAccount(args)?.id).toBe('c')
  })

  it('skips duplicate emails when an older account has no provider identity', () => {
    const args = fixture()
    args.accounts.accounts[1].providerAccountId = null
    args.accounts.accounts[1].email = ' A@EXAMPLE.COM '
    expect(findAvailableCodexAccount(args)?.id).toBe('c')
  })

  it('does not use desktop previews to recommend remote accounts', () => {
    expect(findAvailableCodexAccount({ ...fixture(), remoteOwned: true })).toBeNull()
  })

  it('only considers accounts in the selected runtime group', () => {
    const args = fixture()
    args.group.targets = args.group.targets.filter((entry) => entry.id === 'a')
    expect(findAvailableCodexAccount(args)).toBeNull()
  })

  it('does not infer exhaustion from stale, expired, unavailable or unknown usage', () => {
    expect(isCodexQuotaExhausted(limits(99), now)).toBe(false)
    expect(isCodexQuotaExhausted({ ...limits(100), updatedAt: now - 300_001 }, now)).toBe(false)
    expect(isCodexQuotaExhausted({ ...limits(100), status: 'error' }, now)).toBe(false)
    expect(isCodexQuotaExhausted({ ...limits(), session: null, weekly: null }, now)).toBe(false)
    expect(isCodexQuotaExhausted(limits(100), now + 60_001)).toBe(false)
  })

  it('does not recommend a switch when current account identity is unknown', () => {
    const args = fixture()
    args.group.targets.forEach((entry) => {
      entry.active = false
    })
    args.group.targets.push({
      id: null,
      label: 'System default',
      active: true,
      runtimeTarget: target
    })
    expect(findAvailableCodexAccount(args)).toBeNull()
    args.accounts.systemDefault = {
      hasAuth: true,
      authKind: 'oauth',
      email: 'a@example.com',
      providerAccountId: 'provider-a',
      workspaceLabel: null
    }
    expect(findAvailableCodexAccount(args)?.id).toBe('b')
  })
})
