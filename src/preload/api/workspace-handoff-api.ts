import type { WorkspaceHandoffRecord } from '../../shared/workspace-handoff-record'

export type WorkspaceHandoffApi = {
  get: (key: string) => Promise<WorkspaceHandoffRecord | null>
  set: (key: string, text: string) => Promise<WorkspaceHandoffRecord>
}
