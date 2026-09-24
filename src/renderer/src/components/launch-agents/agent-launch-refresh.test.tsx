// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentDetectionTarget, UseDetectedAgentsResult } from '@/hooks/useDetectedAgents'
import LaunchAgentsDialog from './LaunchAgentsDialog'
import { AgentPickerPane } from '../agent-picker/AgentPickerPane'

const mocks = vi.hoisted(() => ({
  target: { kind: 'local', worktreeId: 'folder:project' } as AgentDetectionTarget,
  detection: {} as UseDetectedAgentsResult,
  refresh: vi.fn(),
  detect: vi.fn(),
  state: {
    activeModal: 'launch-agents',
    closeModal: vi.fn(),
    modalData: {},
    activeRepoId: 'project',
    activeWorktreeId: 'folder:project',
    repos: [{ id: 'project', displayName: 'Project', path: '/project', kind: 'folder' }],
    worktreesByRepo: {
      project: [{ id: 'folder:project', repoId: 'project', displayName: 'Project' }]
    },
    settings: { disabledTuiAgents: [], defaultTuiAgent: null }
  }
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@/hooks/useAgentDetectionTarget', () => ({
  useAgentDetectionTargetForWorktree: () => mocks.target
}))
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: (target: AgentDetectionTarget) => {
    mocks.detect(target)
    return mocks.detection
  }
}))
vi.mock('@/hooks/useRetiredWorktreeNames', () => ({ useRetiredWorktreeNames: () => ({}) }))

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.refresh.mockResolvedValue(['claude', 'codex'])
  mocks.detection = {
    detectedIds: ['claude'],
    isLoading: false,
    detectionFailed: false,
    isRefreshing: false,
    refresh: mocks.refresh
  }
})

const surfaces = [
  { name: 'launch dialog', component: () => <LaunchAgentsDialog /> },
  {
    name: 'pane picker',
    component: () => (
      <AgentPickerPane worktreeId="folder:project" workspaceName="Project" onPick={vi.fn()} />
    )
  }
]
const targets: AgentDetectionTarget[] = [
  { kind: 'local', worktreeId: 'folder:project', contextKey: 'wsl:Ubuntu' },
  { kind: 'ssh', connectionId: 'remote-host' },
  { kind: 'runtime', environmentId: 'runtime-host' }
]

describe.each(surfaces)('$name agent refresh', ({ component }) => {
  it.each(targets)('discovers newly installed Codex on $kind without reopening', (target) => {
    mocks.target = target
    const view = render(component())
    expect(screen.queryByText('Codex')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh agents' }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.detect).toHaveBeenLastCalledWith(target)

    mocks.detection = { ...mocks.detection, detectedIds: ['claude', 'codex'] }
    view.rerender(component())
    expect(screen.getByText('Codex')).toBeTruthy()
  })

  it.each(['isLoading', 'isRefreshing'] as const)('prevents another probe during %s', (flag) => {
    mocks.detection = { ...mocks.detection, [flag]: true }
    render(component())
    const refreshButton = screen.getByRole('button', { name: 'Refresh agents' })
    expect((refreshButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(refreshButton)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})

describe('launch dialog detection state', () => {
  it('moves its selection and lineup when the selected CLI disappears', async () => {
    mocks.target = { kind: 'local', worktreeId: 'folder:project' }
    mocks.detection = { ...mocks.detection, detectedIds: ['claude', 'codex'] }
    const view = render(<LaunchAgentsDialog />)
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }))
    expect(screen.getByRole('button', { name: /Codex/ }).getAttribute('aria-pressed')).toBe('true')

    mocks.detection = { ...mocks.detection, detectedIds: ['claude'] }
    view.rerender(<LaunchAgentsDialog />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Claude/ }).getAttribute('aria-pressed')).toBe(
        'true'
      )
      expect(screen.queryByRole('button', { name: /Codex/ })).toBeNull()
    })
  })

  it('disables launch and distinguishes failed detection from an empty result', () => {
    mocks.target = { kind: 'ssh', connectionId: 'remote-host' }
    mocks.detection = {
      ...mocks.detection,
      detectedIds: null,
      detectionFailed: true
    }
    const view = render(<LaunchAgentsDialog />)
    expect(
      screen.getByText('Could not check this host for agent CLIs. Try Refresh agents.')
    ).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Launch 0' }) as HTMLButtonElement).disabled).toBe(
      true
    )

    mocks.detection = { ...mocks.detection, detectedIds: [], detectionFailed: false }
    view.rerender(<LaunchAgentsDialog />)
    expect(screen.getByText('No agent CLIs detected on this host yet.')).toBeTruthy()
  })
})
