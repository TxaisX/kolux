import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'
import type {
  TerminalWindowFocusResult,
  TerminalWindowOpenArgs,
  TerminalWindowOpenResult,
  TerminalWindowSummary
} from './terminal-windows-api'

export const terminalWindowsApi = {
  open: (args: TerminalWindowOpenArgs): Promise<TerminalWindowOpenResult> =>
    ipcRenderer.invoke('terminalWindows:open', args),
  close: (args: { sessionKey: string }): Promise<{ ok: true }> =>
    ipcRenderer.invoke('terminalWindows:close', args),
  focus: (args: { sessionKey: string }): Promise<TerminalWindowFocusResult> =>
    ipcRenderer.invoke('terminalWindows:focus', args),
  list: (): Promise<{ sessions: TerminalWindowSummary[] }> =>
    ipcRenderer.invoke('terminalWindows:list')
} satisfies PreloadApi['terminalWindows']
