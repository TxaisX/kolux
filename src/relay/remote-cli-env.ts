export function pickRemoteCliEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const picked: Record<string, string> = {}
  for (const key of [
    'KOLUX_TERMINAL_HANDLE',
    'KOLUX_WORKTREE_ID',
    'KOLUX_PANE_KEY',
    'KOLUX_AGENT_LAUNCH_TOKEN',
    'KOLUX_WORKSPACE_ID',
    'KOLUX_USER_DATA_PATH',
    'PATH',
    'Path'
  ]) {
    const value = env[key]
    if (typeof value === 'string') {
      picked[key] = value
    }
  }
  return picked
}
