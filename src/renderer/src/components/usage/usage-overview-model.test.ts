import { describe, expect, it } from 'vitest'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { buildUsageOverviewModel, type UsageOverviewModelInput } from './usage-overview-model'

const NOW = new Date('2026-09-14T12:00:00').getTime()

function emptyUsage() {
  return { scanState: null, summary: null, daily: [], recentSessions: [] }
}

function baseInput(): UsageOverviewModelInput {
  return {
    rateLimits: createEmptyRateLimitState(),
    claudeUsage: emptyUsage(),
    codexUsage: emptyUsage(),
    detectedAgentIds: null,
    now: NOW
  }
}

function claudeRateLimits(overrides: Partial<ProviderRateLimits> = {}): ProviderRateLimits {
  return {
    provider: 'claude',
    session: {
      usedPercent: 42,
      windowMinutes: 300,
      resetsAt: NOW + 2 * 60 * 60 * 1000 + 10 * 60 * 1000,
      resetDescription: null
    },
    weekly: { usedPercent: 10, windowMinutes: 10080, resetsAt: null, resetDescription: null },
    updatedAt: NOW - 1000,
    error: null,
    status: 'ok',
    ...overrides
  }
}

describe('buildUsageOverviewModel', () => {
  it('includes every rate-limit provider even when nothing is configured', () => {
    const model = buildUsageOverviewModel(baseInput())
    const ids = model.providers.map((p) => p.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'claude',
        'codex',
        'gemini',
        'kimi',
        'antigravity',
        'minimax',
        'grok'
      ])
    )
    expect(model.providers.find((p) => p.id === 'claude')?.status).toBe('unavailable')
  })

  it('computes usedPercent and a resets-in label for each window', () => {
    const input = baseInput()
    input.rateLimits.claude = claudeRateLimits()
    const model = buildUsageOverviewModel(input)
    const claude = model.providers.find((p) => p.id === 'claude')
    expect(claude?.status).toBe('ok')
    const session = claude?.windows.find((w) => w.label === 'Session')
    expect(session?.usedPercent).toBe(42)
    expect(session?.resetsInLabel).toBe('Resets in 2h 10m')
    const weekly = claude?.windows.find((w) => w.label === 'Weekly')
    expect(weekly?.resetsInLabel).toBeNull()
  })

  it('maps fetching/error/unavailable statuses through', () => {
    const input = baseInput()
    input.rateLimits.codex = claudeRateLimits({
      provider: 'codex',
      status: 'fetching',
      session: null,
      weekly: null
    })
    input.rateLimits.gemini = claudeRateLimits({
      provider: 'gemini',
      status: 'error',
      error: 'boom',
      session: null,
      weekly: null
    })
    const model = buildUsageOverviewModel(input)
    expect(model.providers.find((p) => p.id === 'codex')?.status).toBe('fetching')
    const gemini = model.providers.find((p) => p.id === 'gemini')
    expect(gemini?.status).toBe('error')
    expect(gemini?.error).toBe('boom')
  })

  it("folds today's tokens and recent sessions in from the usage slice", () => {
    const input = baseInput()
    input.rateLimits.claude = claudeRateLimits()
    input.claudeUsage = {
      scanState: {
        enabled: true,
        isScanning: false,
        lastScanStartedAt: 0,
        lastScanCompletedAt: NOW,
        lastScanError: null,
        hasAnyClaudeData: true
      },
      summary: null,
      daily: [
        {
          day: '2026-09-14',
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        },
        {
          day: '2026-09-13',
          inputTokens: 999,
          outputTokens: 999,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        }
      ],
      recentSessions: [
        {
          sessionId: 's1',
          lastActiveAt: '2026-09-14T11:00:00.000Z',
          durationMinutes: 5,
          projectLabel: 'kolux',
          branch: null,
          model: 'claude',
          turns: 3,
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0
        }
      ]
    }
    const model = buildUsageOverviewModel(input)
    const claude = model.providers.find((p) => p.id === 'claude')
    expect(claude?.todayTokens).toBe(150)
    expect(claude?.recentSessions).toEqual([
      { label: 'kolux', tokens: 15, when: '2026-09-14T11:00:00.000Z' }
    ])
  })

  it('lists a detected agent with no rate-limit or usage source as unavailable', () => {
    const input = baseInput()
    input.detectedAgentIds = ['claude', 'goose']
    const model = buildUsageOverviewModel(input)
    const goose = model.providers.find((p) => p.id === 'goose')
    expect(goose).toEqual(
      expect.objectContaining({ id: 'goose', detected: true, status: 'unavailable', windows: [] })
    )
  })

  it('marks a CLI-gated provider as not detected when PATH detection ran and missed it', () => {
    const input = baseInput()
    input.rateLimits.gemini = claudeRateLimits({ provider: 'gemini' })
    input.detectedAgentIds = ['claude']
    const model = buildUsageOverviewModel(input)
    expect(model.providers.find((p) => p.id === 'gemini')?.detected).toBe(false)
  })
})
