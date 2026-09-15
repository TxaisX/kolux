import { ipcRenderer } from 'electron'
import type { WorkspaceHandoffRecord } from '../../shared/workspace-handoff-record'
import type { PreloadApi } from '../api-types'

export const workspaceHandoffApi = {
  get: (key: string): Promise<WorkspaceHandoffRecord | null> =>
    ipcRenderer.invoke('workspaceHandoff:get', key),
  set: (key: string, text: string): Promise<WorkspaceHandoffRecord> =>
    ipcRenderer.invoke('workspaceHandoff:set', key, text)
} satisfies PreloadApi['workspaceHandoff']
