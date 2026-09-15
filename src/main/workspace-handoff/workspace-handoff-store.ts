import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import type { WorkspaceHandoffRecord } from '../../shared/workspace-handoff-record'

export const WORKSPACE_HANDOFF_DIR_NAME = 'workspace-handoffs'

/**
 * One markdown document per workspace key (see `buildWorkspaceHandoffKey`), stored under the
 * app's userData directory as `<key>.json`. Pure fs — never shells out — so this works
 * identically for local, SSH and WSL-owned workspaces: the document always lives on *this*
 * client, keyed by the workspace's host + path, so a remote workspace never needs its own
 * filesystem touched to have a handoff.
 */
export class WorkspaceHandoffStore {
  constructor(private readonly getDir: () => string) {}

  read(key: string): WorkspaceHandoffRecord | null {
    try {
      const raw = readFileSync(this.filePath(key), 'utf-8')
      const parsed = JSON.parse(raw) as Partial<WorkspaceHandoffRecord>
      if (typeof parsed.text !== 'string' || typeof parsed.updatedAt !== 'number') {
        return null
      }
      return { text: parsed.text, updatedAt: parsed.updatedAt }
    } catch {
      return null
    }
  }

  write(key: string, text: string): WorkspaceHandoffRecord {
    const record: WorkspaceHandoffRecord = { text, updatedAt: Date.now() }
    mkdirSync(this.getDir(), { recursive: true })
    writeFileAtomically(this.filePath(key), JSON.stringify(record))
    return record
  }

  private filePath(key: string): string {
    return join(this.getDir(), `${key}.json`)
  }
}
