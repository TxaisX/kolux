import { ipcRenderer } from 'electron'
import type { TuiAgent } from '../../shared/tui-agent'
import type { PreloadApi } from '../api-types'

export const agentTrustApi = {
  markTrusted: (args: {
    preset: 'cursor' | 'copilot' | 'codex' | 'claude'
    workspacePath: string
    connectionId?: string
  }): Promise<void> => ipcRenderer.invoke('agentTrust:markTrusted', args),
  preTrustWorktrees: (args: {
    repoId: string
    agent: TuiAgent
    worktreeNames: string[]
  }): Promise<{ ok: true } | { error: string }> =>
    ipcRenderer.invoke('agentTrust:preTrustWorktrees', args)
} satisfies PreloadApi['agentTrust']
