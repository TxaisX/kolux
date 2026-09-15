// Pure model combining rate limits + usage snapshots + detected agents into one
// "usage across every CLI" view. No React/store imports so it stays cheaply testable.
import type { ProviderRateLimits, RateLimitState, RateLimitWindow } from '../../../../shared/rate-limit-types'
import { formatResetCountdown } from '../../../../shared/rate-limit-reset-format'
import { clampUsedPercent } from '../../../../shared/usage-percentage-display'
import type {
  ClaudeUsageDailyPoint,
  ClaudeUsageScanState,
  ClaudeUsageSessionRow,
  ClaudeUsageSummary
} from '../../../../shared/claude-usage-types'
import type {
  CodexUsageDailyPoint,
  CodexUsageScanState,
  CodexUsageSessionRow,
  CodexUsageSummary
} from '../../../../shared/codex-usage-types'
import type {
  OpenCodeUsageDailyPoint,
  OpenCodeUsageScanState,
  OpenCodeUsageSessionRow,
  OpenCodeUsageSummary
} from '../../../../shared/opencode-usage-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { getAgentLabel } from '@/lib/agent-catalog'
import { getProviderDisplayName } from '../status-bar/usage-error-copy'
import { translate } from '@/i18n/i18n'

export type UsageWindowRow = {
  label: string
  usedPercent: number
  resetsAt: number | null
  resetsInLabel: string | null
}

export type UsageRecentSessionRow = {
  label: string
  tokens: number
  when: string
}

export type UsageOverviewProviderStatus = 'ok' | 'fetching' | 'error' | 'unavailable'

export type UsageOverviewProvider = {
  id: string
  label: string
  detected: boolean
  account?: string
  windows: UsageWindowRow[]
  todayTokens?: number
  todayCost?: number | null
  recentSessions?: UsageRecentSessionRow[]
  status: UsageOverviewProviderStatus
  error?: string | null
}

export type UsageOverviewModel = {
  providers: UsageOverviewProvider[]
  updatedAt: number
}

type UsageSnapshotInput<Scan, Summary, Daily, Session> = {
  scanState: Scan | null
  summary: Summary | null
  daily: Daily[]
  recentSessions: Session[]
}

export type UsageOverviewModelInput = {
  rateLimits: RateLimitState
  claudeUsage: UsageSnapshotInput<
    ClaudeUsageScanState,
    ClaudeUsageSummary,
    ClaudeUsageDailyPoint,
    ClaudeUsageSessionRow
  >
  codexUsage: UsageSnapshotInput<
    CodexUsageScanState,
    CodexUsageSummary,
    CodexUsageDailyPoint,
    CodexUsageSessionRow
  >
  openCodeUsage: UsageSnapshotInput<
    OpenCodeUsageScanState,
    OpenCodeUsageSummary,
    OpenCodeUsageDailyPoint,
    OpenCodeUsageSessionRow
  >
  detectedAgentIds: TuiAgent[] | null
  claudeAccount?: string | null
  codexAccount?: string | null
  /** Injectable for deterministic tests; defaults to Date.now(). */
  now?: number
}

const RECENT_SESSION_LIMIT = 5

// Local day key matching the main-process usage scanners (YYYY-MM-DD, local time).
function todayKey(now: number): string {
  const date = new Date(now)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function buildWindows(p: ProviderRateLimits, now: number): UsageWindowRow[] {
  const sections: { label: string; window: RateLimitWindow | null | undefined }[] = [
    { label: translate('components.usage.window.session', 'Session'), window: p.session },
    { label: translate('components.usage.window.weekly', 'Weekly'), window: p.weekly },
    { label: translate('components.usage.window.fable', 'Fable'), window: p.fableWeekly },
    { label: translate('components.usage.window.monthly', 'Monthly'), window: p.monthly },
    ...(p.buckets ?? []).map((bucket) => ({ label: bucket.name, window: bucket }))
  ]
  return sections
    .filter(
      (section): section is { label: string; window: RateLimitWindow } =>
        section.window !== null && section.window !== undefined
    )
    .map((section) => ({
      label: section.label,
      usedPercent: clampUsedPercent(section.window.usedPercent),
      resetsAt: section.window.resetsAt,
      resetsInLabel:
        section.window.resetsAt !== null
          ? formatResetCountdown(section.window.resetsAt - now)
          : null
    }))
}

function mapStatus(p: ProviderRateLimits | null): UsageOverviewProviderStatus {
  if (!p) {
    return 'unavailable'
  }
  if (p.status === 'idle') {
    return 'fetching'
  }
  return p.status
}

type RateLimitProviderKey =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'opencodeGo'
  | 'kimi'
  | 'antigravity'
  | 'minimax'
  | 'grok'

const RATE_LIMIT_PROVIDERS: {
  key: RateLimitProviderKey
  providerId: ProviderRateLimits['provider']
  tuiAgent: TuiAgent | null
}[] = [
  { key: 'claude', providerId: 'claude', tuiAgent: 'claude' },
  { key: 'codex', providerId: 'codex', tuiAgent: 'codex' },
  { key: 'gemini', providerId: 'gemini', tuiAgent: 'gemini' },
  { key: 'opencodeGo', providerId: 'opencode-go', tuiAgent: 'opencode' },
  { key: 'kimi', providerId: 'kimi', tuiAgent: 'kimi' },
  { key: 'antigravity', providerId: 'antigravity', tuiAgent: 'antigravity' },
  { key: 'minimax', providerId: 'minimax', tuiAgent: null },
  { key: 'grok', providerId: 'grok', tuiAgent: 'grok' }
]

function isDetected(
  tuiAgent: TuiAgent | null,
  detectedAgentIds: TuiAgent[] | null,
  fallback: boolean
): boolean {
  if (!tuiAgent) {
    return fallback
  }
  // Why: detection runs async on mount; treat "not probed yet" as present so a
  // real CLI isn't flashed as missing before the first probe resolves.
  return detectedAgentIds === null ? true : detectedAgentIds.includes(tuiAgent)
}

function buildRateLimitProviders(
  rateLimits: RateLimitState,
  detectedAgentIds: TuiAgent[] | null,
  now: number
): UsageOverviewProvider[] {
  return RATE_LIMIT_PROVIDERS.map(({ key, providerId, tuiAgent }) => {
    const p = rateLimits[key]
    const minimaxConfigured = rateLimits.minimaxCookieConfigured || rateLimits.minimaxApiKeyConfigured
    return {
      id: tuiAgent ?? key,
      label: getProviderDisplayName(providerId),
      detected: isDetected(tuiAgent, detectedAgentIds, key === 'minimax' && minimaxConfigured),
      windows: p ? buildWindows(p, now) : [],
      status: mapStatus(p),
      error: p?.error ?? null
    }
  })
}

function sumClaudeTokens(entry: {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}): number {
  return entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheWriteTokens
}

function findToday<T extends { day: string }>(daily: T[], now: number): T | undefined {
  const today = todayKey(now)
  return daily.find((entry) => entry.day === today)
}

function withUsageExtras(
  provider: UsageOverviewProvider,
  extras: { account?: string | null; todayTokens: number; recentSessions: UsageRecentSessionRow[] } | null
): UsageOverviewProvider {
  if (!extras) {
    return provider
  }
  return {
    ...provider,
    account: extras.account ?? provider.account,
    todayTokens: extras.todayTokens,
    todayCost: null,
    recentSessions: extras.recentSessions
  }
}

function applyClaudeExtras(
  provider: UsageOverviewProvider,
  usage: UsageOverviewModelInput['claudeUsage'],
  account: string | null | undefined,
  now: number
): UsageOverviewProvider {
  if (!usage.scanState?.enabled) {
    return provider
  }
  const today = findToday(usage.daily, now)
  const recentSessions = usage.recentSessions.slice(0, RECENT_SESSION_LIMIT).map((row) => ({
    label: row.projectLabel || row.model || 'Session',
    tokens: sumClaudeTokens(row),
    when: row.lastActiveAt
  }))
  return withUsageExtras(provider, {
    account,
    todayTokens: today ? sumClaudeTokens(today) : 0,
    recentSessions
  })
}

function applyCodexExtras(
  provider: UsageOverviewProvider,
  usage: UsageOverviewModelInput['codexUsage'],
  account: string | null | undefined,
  now: number
): UsageOverviewProvider {
  if (!usage.scanState?.enabled) {
    return provider
  }
  const today = findToday(usage.daily, now)
  const recentSessions = usage.recentSessions.slice(0, RECENT_SESSION_LIMIT).map((row) => ({
    label: row.projectLabel || row.model || 'Session',
    tokens: row.totalTokens,
    when: row.lastActiveAt
  }))
  return withUsageExtras(provider, {
    account,
    todayTokens: today ? today.totalTokens : 0,
    recentSessions
  })
}

function applyOpenCodeExtras(
  provider: UsageOverviewProvider,
  usage: UsageOverviewModelInput['openCodeUsage'],
  now: number
): UsageOverviewProvider {
  if (!usage.scanState?.enabled) {
    return provider
  }
  const today = findToday(usage.daily, now)
  const recentSessions = usage.recentSessions.slice(0, RECENT_SESSION_LIMIT).map((row) => ({
    label: row.projectLabel || row.model || 'Session',
    tokens: row.totalTokens,
    when: row.lastActiveAt
  }))
  return withUsageExtras(provider, {
    todayTokens: today ? today.totalTokens : 0,
    recentSessions
  })
}

/** Builds the "usage across every CLI" view from rate limits, usage snapshots, and detected agents. */
export function buildUsageOverviewModel(input: UsageOverviewModelInput): UsageOverviewModel {
  const now = input.now ?? Date.now()
  const providers = buildRateLimitProviders(input.rateLimits, input.detectedAgentIds, now).map(
    (provider) => {
      if (provider.id === 'claude') {
        return applyClaudeExtras(provider, input.claudeUsage, input.claudeAccount, now)
      }
      if (provider.id === 'codex') {
        return applyCodexExtras(provider, input.codexUsage, input.codexAccount, now)
      }
      if (provider.id === 'opencode') {
        return applyOpenCodeExtras(provider, input.openCodeUsage, now)
      }
      return provider
    }
  )

  const coveredIds = new Set(providers.map((p) => p.id))
  const extraDetected = (input.detectedAgentIds ?? []).filter((agent) => !coveredIds.has(agent))
  for (const agent of extraDetected) {
    providers.push({
      id: agent,
      label: getAgentLabel(agent),
      detected: true,
      windows: [],
      status: 'unavailable'
    })
  }

  const timestamps: number[] = [
    ...RATE_LIMIT_PROVIDERS.map(({ key }) => input.rateLimits[key]?.updatedAt ?? 0),
    input.claudeUsage.scanState?.lastScanCompletedAt ?? 0,
    input.codexUsage.scanState?.lastScanCompletedAt ?? 0,
    input.openCodeUsage.scanState?.lastScanCompletedAt ?? 0
  ]
  const updatedAt = Math.max(0, ...timestamps)

  return { providers, updatedAt: updatedAt || now }
}
