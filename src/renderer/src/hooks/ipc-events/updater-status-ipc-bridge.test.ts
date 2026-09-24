import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerUpdaterStatusIpcBridge } from './updater-status-ipc-bridge'

const mocks = vi.hoisted(() => ({ setUpdateStatus: vi.fn() }))
vi.mock('sonner', () => ({ toast: { info: vi.fn() } }))

vi.mock('../../store', () => ({
  useAppStore: {
    getState: () => ({
      setUpdateStatus: mocks.setUpdateStatus,
      clearDismissedUpdateVersion: vi.fn()
    })
  }
}))

describe('registerUpdaterStatusIpcBridge', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllGlobals()
  })

  it('subscribes before the snapshot and ignores a snapshot older than a live update', async () => {
    const order: string[] = []
    let resolveSnapshot: ((status: { state: string }) => void) | undefined
    let statusListener: ((status: unknown) => void) | undefined
    const statusCleanup = vi.fn()
    const dismissalCleanup = vi.fn()
    vi.stubGlobal('window', {
      api: {
        updater: {
          getStatus: () => {
            order.push('snapshot')
            return new Promise<{ state: string }>((resolve) => {
              resolveSnapshot = resolve
            })
          },
          onStatus: (listener: (status: unknown) => void) => {
            order.push('listener')
            statusListener = listener
            return statusCleanup
          },
          onClearDismissal: () => dismissalCleanup
        }
      }
    })

    const unsubs: (() => void)[] = []
    registerUpdaterStatusIpcBridge(unsubs)

    expect(order).toEqual(['listener', 'snapshot'])
    statusListener?.({ state: 'available', version: '0.10.9', changelog: null })
    resolveSnapshot?.({ state: 'idle' })
    await Promise.resolve()
    expect(mocks.setUpdateStatus.mock.calls).toEqual([
      [{ state: 'available', version: '0.10.9', changelog: null }]
    ])

    unsubs.forEach((unsubscribe) => unsubscribe())
    expect(statusCleanup).toHaveBeenCalledOnce()
    expect(dismissalCleanup).toHaveBeenCalledOnce()
  })

  it('announces each newly available version once', async () => {
    const { toast } = await import('sonner')
    let statusListener: ((status: unknown) => void) | undefined
    vi.stubGlobal('window', {
      api: {
        updater: {
          getStatus: () => Promise.resolve({ state: 'idle' }),
          onStatus: (listener: (status: unknown) => void) => {
            statusListener = listener
            return vi.fn()
          },
          onClearDismissal: () => vi.fn()
        }
      }
    })

    registerUpdaterStatusIpcBridge([])
    await Promise.resolve()
    statusListener?.({ state: 'available', version: '0.11.0', changelog: null })
    statusListener?.({ state: 'available', version: '0.11.0', changelog: null })

    expect(toast.info).toHaveBeenCalledOnce()
    expect(toast.info).toHaveBeenCalledWith(
      'Kolux v0.11.0 is available',
      expect.objectContaining({ description: expect.stringContaining('Restart') })
    )
  })
})
