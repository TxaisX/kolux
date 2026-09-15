export type TerminalWindowOpenArgs = {
  worktreeId: string
  tabId: string
  ptyId?: string
}

export type TerminalWindowOpenResult = { ok: true; sessionKey: string } | { error: string }
export type TerminalWindowFocusResult = { ok: true } | { error: string }

export type TerminalWindowSummary = {
  sessionKey: string
  worktreeId: string
  tabId: string
  focused: boolean
}

export type TerminalWindowsApi = {
  open: (args: TerminalWindowOpenArgs) => Promise<TerminalWindowOpenResult>
  close: (args: { sessionKey: string }) => Promise<{ ok: true }>
  focus: (args: { sessionKey: string }) => Promise<TerminalWindowFocusResult>
  list: () => Promise<{ sessions: TerminalWindowSummary[] }>
}
