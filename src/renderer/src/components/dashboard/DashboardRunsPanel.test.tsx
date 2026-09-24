// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardRunsPanel } from './DashboardRunsPanel'

const mocks = vi.hoisted(() => ({ callRuntimeRpc: vi.fn() }))
vi.mock('@/runtime/runtime-rpc-client', () => ({ callRuntimeRpc: mocks.callRuntimeRpc }))

const run = {
  id: 'run-1',
  objective: 'Improve session launch',
  created_at: '2026-09-22T00:00:00Z',
  coordinator_handle: 'term-1',
  legacy: 0
}
const task = {
  id: 'task-1',
  task_title: 'Fix SSH quoting',
  display_name: null,
  spec: 'Use the remote platform',
  status: 'ready'
}

beforeEach(() => {
  mocks.callRuntimeRpc.mockReset()
  mocks.callRuntimeRpc.mockImplementation((_target, method) =>
    Promise.resolve(
      method === 'orchestration.runList'
        ? { runs: [run], nextCursor: null }
        : { tasks: [task], count: 1 }
    )
  )
})
afterEach(cleanup)

describe('DashboardRunsPanel', () => {
  it('lists runs and tasks from the selected runtime, then refreshes both', async () => {
    render(<DashboardRunsPanel hostId="runtime:remote-1" onBack={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('Fix SSH quoting')).toBeTruthy()
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'remote-1' },
      'orchestration.runList',
      { limit: 30 },
      expect.anything()
    )
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'remote-1' },
      'orchestration.taskList',
      { run: 'run-1', brief: true },
      expect.anything()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh runs' }))
    await waitFor(() => expect(mocks.callRuntimeRpc).toHaveBeenCalledTimes(4))
  })

  it('explains direct SSH without reading the local run ledger', () => {
    render(<DashboardRunsPanel hostId="ssh:builder" onBack={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/Direct SSH workspaces do not expose the run ledger/)).toBeTruthy()
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })

  it('shows unresolved ownership without guessing local', () => {
    render(<DashboardRunsPanel hostId={null} onBack={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(/active workspace host is still loading/)).toBeTruthy()
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
  })
})
