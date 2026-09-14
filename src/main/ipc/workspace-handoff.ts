import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import {
  WORKSPACE_HANDOFF_DIR_NAME,
  WorkspaceHandoffStore
} from '../workspace-handoff/workspace-handoff-store'
import { WORKSPACE_HANDOFF_KEY_PATTERN } from '../../shared/workspace-handoff-key'
import {
  WORKSPACE_HANDOFF_MAX_TEXT_BYTES,
  type WorkspaceHandoffRecord
} from '../../shared/workspace-handoff-record'

let store: WorkspaceHandoffStore | null = null

function getStore(): WorkspaceHandoffStore {
  if (!store) {
    store = new WorkspaceHandoffStore(() => join(app.getPath('userData'), WORKSPACE_HANDOFF_DIR_NAME))
  }
  return store
}

function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !WORKSPACE_HANDOFF_KEY_PATTERN.test(key)) {
    throw new Error('Invalid workspace handoff key.')
  }
}

function assertValidText(text: unknown): asserts text is string {
  if (typeof text !== 'string') {
    throw new Error('Workspace handoff text must be a string.')
  }
  if (Buffer.byteLength(text, 'utf-8') > WORKSPACE_HANDOFF_MAX_TEXT_BYTES) {
    throw new Error('Workspace handoff text is too large.')
  }
}

export function registerWorkspaceHandoffHandlers(): void {
  ipcMain.handle('workspaceHandoff:get', (_event, key: unknown): WorkspaceHandoffRecord | null => {
    assertValidKey(key)
    return getStore().read(key)
  })

  ipcMain.handle(
    'workspaceHandoff:set',
    (_event, key: unknown, text: unknown): WorkspaceHandoffRecord => {
      assertValidKey(key)
      assertValidText(text)
      return getStore().write(key, text)
    }
  )
}
