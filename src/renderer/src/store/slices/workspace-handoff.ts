import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { WorkspaceHandoffRecord } from '../../../../shared/workspace-handoff-record'

export type WorkspaceHandoffCacheEntry = {
  record: WorkspaceHandoffRecord | null
  status: 'loading' | 'loaded' | 'error'
}

export type WorkspaceHandoffSlice = {
  workspaceHandoffByKey: Record<string, WorkspaceHandoffCacheEntry>
  /** No-op when a load or a fresh copy is already cached for this key. */
  loadWorkspaceHandoff: (key: string) => Promise<void>
  saveWorkspaceHandoff: (key: string, text: string) => Promise<WorkspaceHandoffRecord | null>
}

export const createWorkspaceHandoffSlice: StateCreator<
  AppState,
  [],
  [],
  WorkspaceHandoffSlice
> = (set, get) => ({
  workspaceHandoffByKey: {},

  loadWorkspaceHandoff: async (key) => {
    const existing = get().workspaceHandoffByKey[key]
    if (existing?.status === 'loading' || existing?.status === 'loaded') {
      return
    }
    set((s) => ({
      workspaceHandoffByKey: {
        ...s.workspaceHandoffByKey,
        [key]: { record: existing?.record ?? null, status: 'loading' }
      }
    }))
    try {
      const record = await window.api.workspaceHandoff.get(key)
      set((s) => ({
        workspaceHandoffByKey: {
          ...s.workspaceHandoffByKey,
          [key]: { record: record ?? null, status: 'loaded' }
        }
      }))
    } catch (error) {
      console.error('Failed to load workspace handoff:', error)
      set((s) => ({
        workspaceHandoffByKey: {
          ...s.workspaceHandoffByKey,
          [key]: { record: existing?.record ?? null, status: 'error' }
        }
      }))
    }
  },

  saveWorkspaceHandoff: async (key, text) => {
    try {
      // Why: the web build has no handoff IPC (falls back to undefined) — keep the
      // optimistic timestamp so the panel still reports a save instead of erroring.
      const record = (await window.api.workspaceHandoff.set(key, text)) ?? {
        text,
        updatedAt: Date.now()
      }
      set((s) => ({
        workspaceHandoffByKey: { ...s.workspaceHandoffByKey, [key]: { record, status: 'loaded' } }
      }))
      return record
    } catch (error) {
      console.error('Failed to save workspace handoff:', error)
      return null
    }
  }
})
