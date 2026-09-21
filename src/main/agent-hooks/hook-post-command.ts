import type { AgentHookSource } from '../../shared/agent-hook-relay'
import { KOLUX_HOOK_RAW_JSON_TRANSPORT } from '../../shared/agent-hook-types'

export function buildPosixAgentHookPostCommand(
  source: AgentHookSource,
  options: { curlCommand?: string; indent?: string } = {}
): string[] {
  const curlCommand = options.curlCommand ?? 'curl'
  const indent = options.indent ?? '  '
  return [
    `if [ "\${KOLUX_AGENT_HOOK_TRANSPORT:-}" = "${KOLUX_HOOK_RAW_JSON_TRANSPORT}" ] && command -v base64 >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then`,
    `  kolux_hook_metadata=$(printf '%s\\037%s\\037%s\\037%s\\037%s\\037%s' "$KOLUX_PANE_KEY" "$KOLUX_TAB_ID" "$KOLUX_AGENT_LAUNCH_TOKEN" "$KOLUX_WORKTREE_ID" "$KOLUX_AGENT_HOOK_ENV" "$KOLUX_AGENT_HOOK_VERSION" | base64 | tr -d '\\n') && \\`,
    `  [ -n "$kolux_hook_metadata" ] && \\`,
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST "http://127.0.0.1:\${KOLUX_AGENT_HOOK_PORT}/hook/${source}" \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/json" \\`,
    `  ${indent}-H "X-Kolux-Agent-Hook-Token: \${KOLUX_AGENT_HOOK_TOKEN}" \\`,
    `  ${indent}-H "X-Kolux-Agent-Hook-Meta-Encoding: base64" \\`,
    `  ${indent}-H "X-Kolux-Agent-Hook-Meta: \${kolux_hook_metadata}" \\`,
    `  ${indent}--data-binary @-`,
    'else',
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST "http://127.0.0.1:\${KOLUX_AGENT_HOOK_PORT}/hook/${source}" \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/x-www-form-urlencoded" \\`,
    `  ${indent}-H "X-Kolux-Agent-Hook-Token: \${KOLUX_AGENT_HOOK_TOKEN}" \\`,
    `  ${indent}--data-urlencode "paneKey=\${KOLUX_PANE_KEY}" \\`,
    `  ${indent}--data-urlencode "tabId=\${KOLUX_TAB_ID}" \\`,
    `  ${indent}--data-urlencode "launchToken=\${KOLUX_AGENT_LAUNCH_TOKEN}" \\`,
    `  ${indent}--data-urlencode "worktreeId=\${KOLUX_WORKTREE_ID}" \\`,
    `  ${indent}--data-urlencode "env=\${KOLUX_AGENT_HOOK_ENV}" \\`,
    `  ${indent}--data-urlencode "version=\${KOLUX_AGENT_HOOK_VERSION}" \\`,
    `  ${indent}--data-urlencode "payload@-"`,
    'fi'
  ]
}
