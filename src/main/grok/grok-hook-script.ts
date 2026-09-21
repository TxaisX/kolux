import {
  getSharedManagedScriptPath,
  wrapPosixHookCommand,
  wrapWindowsCmdHookCommand
} from '../agent-hooks/installer-utils'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines
} from '../agent-hooks/hook-stdin-contract'
import {
  buildWindowsGrokHookScript,
  GROK_HOME_ENVELOPE_MAX_LENGTH
} from './windows-grok-hook-script'

export function getGrokManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'grok-hook.cmd' : 'grok-hook.sh'
}

export function getGrokManagedScriptPath(): string {
  return getSharedManagedScriptPath(getGrokManagedScriptFileName())
}

export function getGrokManagedCommand(scriptPath: string): string {
  // A cmd-safe bare path avoids two extra Windows interpreters; POSIX can gate before spawning the
  // managed script because Kolux injects KOLUX_PANE_KEY only into panes it owns.
  return process.platform === 'win32'
    ? wrapWindowsCmdHookCommand(scriptPath)
    : wrapPosixHookCommand(scriptPath, {}, { requiredEnvVar: 'KOLUX_PANE_KEY' })
}

export function getGrokManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return buildWindowsGrokHookScript()
  }

  return [
    '#!/bin/sh',
    ...buildPosixHookPayloadCapture(),
    ...buildPosixHookSpoolLines('grok'),
    'if [ -n "$KOLUX_AGENT_HOOK_ENDPOINT" ] && [ -r "$KOLUX_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$KOLUX_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$KOLUX_AGENT_HOOK_PORT" ] || [ -z "$KOLUX_AGENT_HOOK_TOKEN" ] || [ -z "$KOLUX_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    'grok_home=',
    `if [ -n "\${GROK_HOME:-}" ] && [ "\${#GROK_HOME}" -le ${GROK_HOME_ENVELOPE_MAX_LENGTH} ]; then`,
    '  grok_home=$GROK_HOME',
    'fi',
    'printf \'%s\' "$payload" | curl -sS -X POST "http://127.0.0.1:${KOLUX_AGENT_HOOK_PORT}/hook/grok" \\',
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Kolux-Agent-Hook-Token: ${KOLUX_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${KOLUX_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${KOLUX_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${KOLUX_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${KOLUX_WORKTREE_ID}" \\',
    '  --data-urlencode "env=${KOLUX_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${KOLUX_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "grokHome=${grok_home}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
