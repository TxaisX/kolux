import { createStore, type StoreApi } from 'zustand/vanilla'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceHandoffSlice, type WorkspaceHandoffSlice } from './workspace-handoff'
import type { AppState } from '../types'

function createWorkspaceHandoffStore(): StoreApi<AppState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createStore<any>()((...args: any[]) =>
    createWorkspaceHandoffSlice(...(args as Parameters<typeof createWorkspaceHandoffSlice>))
  ) as unknown as StoreApi<AppState>
}

describe('createWorkspaceHandoffSlice', () => {
  const getMock = vi.fn()
  const setMock = vi.fn()

  beforeEach(() => {
    getMock.mockReset()
    setMock.mockReset()
    globalThis.window = {
      api: { workspaceHandoff: { get: getMock, set: setMock } }
    } as never
  })

  it('starts with an empty cache', () => {
    const store = createWorkspaceHandoffStore()
    expect(store.getState().workspaceHandoffByKey).toEqual({})
  })

  it('loads a document and caches it', async () => {
    getMock.mockResolvedValue({ text: 'hello', updatedAt: 5 })
    const store = createWorkspaceHandoffStore()

    await (store.getState() as unknown as WorkspaceHandoffSlice).loadWorkspaceHandoff('key1')

    expect(getMock).toHaveBeenCalledWith('key1')
    expect(store.getState().workspaceHandoffByKey.key1).toEqual({
      record: { text: 'hello', updatedAt: 5 },
      status: 'loaded'
    })
  })

  it('caches a null record for a workspace with no handoff yet', async () => {
    getMock.mockResolvedValue(null)
    const store = createWorkspaceHandoffStore()

    await (store.getState() as unknown as WorkspaceHandoffSlice).loadWorkspaceHandoff('key1')

    expect(store.getState().workspaceHandoffByKey.key1).toEqual({ record: null, status: 'loaded' })
  })

  it('does not re-fetch a key that already loaded', async () => {
    getMock.mockResolvedValue({ text: 'hello', updatedAt: 5 })
    const store = createWorkspaceHandoffStore()
    const slice = store.getState() as unknown as WorkspaceHandoffSlice

    await slice.loadWorkspaceHandoff('key1')
    await slice.loadWorkspaceHandoff('key1')

    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('marks the key as errored when the load rejects, keeping any prior record', async () => {
    getMock.mockRejectedValue(new Error('boom'))
    const store = createWorkspaceHandoffStore()

    await (store.getState() as unknown as WorkspaceHandoffSlice).loadWorkspaceHandoff('key1')

    expect(store.getState().workspaceHandoffByKey.key1).toEqual({ record: null, status: 'error' })
  })

  it('saves text and updates the cache from the returned record', async () => {
    setMock.mockResolvedValue({ text: 'new text', updatedAt: 9 })
    const store = createWorkspaceHandoffStore()

    const result = await (
      store.getState() as unknown as WorkspaceHandoffSlice
    ).saveWorkspaceHandoff('key1', 'new text')

    expect(setMock).toHaveBeenCalledWith('key1', 'new text')
    expect(result).toEqual({ text: 'new text', updatedAt: 9 })
    expect(store.getState().workspaceHandoffByKey.key1).toEqual({
      record: { text: 'new text', updatedAt: 9 },
      status: 'loaded'
    })
  })

  it('falls back to an optimistic timestamp when the host returns nothing (web build)', async () => {
    setMock.mockResolvedValue(undefined)
    const store = createWorkspaceHandoffStore()

    const result = await (
      store.getState() as unknown as WorkspaceHandoffSlice
    ).saveWorkspaceHandoff('key1', 'text')

    expect(result?.text).toBe('text')
    expect(typeof result?.updatedAt).toBe('number')
  })

  it('returns null when saving rejects', async () => {
    setMock.mockRejectedValue(new Error('boom'))
    const store = createWorkspaceHandoffStore()

    const result = await (
      store.getState() as unknown as WorkspaceHandoffSlice
    ).saveWorkspaceHandoff('key1', 'text')

    expect(result).toBeNull()
  })
})
