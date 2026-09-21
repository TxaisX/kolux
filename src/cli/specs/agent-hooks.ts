import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: 'Repair Kolux-managed Codex hook trust before a shell launch',
    usage: 'kolux agent hooks prepare-codex',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Kolux-managed agent status hooks are enabled',
    usage: 'kolux agent hooks status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['kolux agent hooks status', 'kolux agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Kolux-managed agent status hooks and remove local hook entries',
    usage: 'kolux agent hooks off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['kolux agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Kolux-managed agent status hooks',
    usage: 'kolux agent hooks on [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['kolux agent hooks on']
  }
]
