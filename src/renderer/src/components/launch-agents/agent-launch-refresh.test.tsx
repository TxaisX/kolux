// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
