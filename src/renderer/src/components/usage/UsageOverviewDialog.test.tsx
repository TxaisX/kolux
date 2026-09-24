// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'

import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import { createEmptyRateLimitState } from '../../../../shared/rate-limit-state-factory'

const testState = vi.hoisted(() => ({
  refreshRateLimits: vi.fn().mockResolvedValue(undefined),
  refreshDetectedAgents: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../store', () => ({
  useAppStore: (selector: (state: object) => unknown) =>
    selector({
      rateLimits: createEmptyRateLimitState(),
      detectedAgentIds: ['claude', 'codex'],
      settings: getDefaultSettings('/home/test'),
      claudeUsageScanState: null,
      claudeUsageDaily: [],
      claudeUsageRecentSessions: [],
      codexUsageScanState: null,
      codexUsageDaily: [],
      codexUsageRecentSessions: [],
      refreshRateLimits: testState.refreshRateLimits,
      refreshDetectedAgents: testState.refreshDetectedAgents,
      fetchClaudeUsage: vi.fn().mockResolvedValue(undefined),
      fetchCodexUsage: vi.fn().mockResolvedValue(undefined),
      refreshClaudeUsage: vi.fn().mockResolvedValue(undefined),
      refreshCodexUsage: vi.fn().mockResolvedValue(undefined)
    })
}))

vi.mock('../ui/dialog', () => ({
  Dialog: ({ children, open }: { children: ReactNode; open: boolean }) => (open ? children : null),
  DialogContent: ({ children }: { children: ReactNode }) => children,
  DialogHeader: ({ children }: { children: ReactNode }) => children,
  DialogTitle: ({ children }: { children: ReactNode }) => children
}))

import { UsageOverviewDialog } from './UsageOverviewDialog'

afterEach(cleanup)

describe('UsageOverviewDialog', () => {
  it('lists every rate-limit provider when open', () => {
    render(<UsageOverviewDialog open onOpenChange={() => {}} />)
    expect(screen.getByText('Usage across every CLI')).toBeInTheDocument()
    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('Grok')).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    render(<UsageOverviewDialog open={false} onOpenChange={() => {}} />)
    expect(screen.queryByText('Usage across every CLI')).not.toBeInTheDocument()
  })

  it('wires the refresh button to the rate-limit and detected-agent refresh actions', async () => {
    const user = userEvent.setup()
    render(<UsageOverviewDialog open onOpenChange={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Refresh usage' }))
    expect(testState.refreshRateLimits).toHaveBeenCalled()
    expect(testState.refreshDetectedAgents).toHaveBeenCalled()
  })
})
