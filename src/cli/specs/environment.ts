import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const ENVIRONMENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['host', 'list'],
    summary: 'List every machine this Kolux host can target, and how to name each one',
    usage: 'kolux host list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Answers "what can I target and what do I pass" in one place: this machine, the SSH targets registered on it, and the Kolux servers paired with it.',
      'The three kinds are reached differently. A paired Kolux server is a connection, selected with --environment <name>. An SSH target is a machine the connected Kolux host reaches, selected with --host ssh:<id>. Passing one where the other belongs is the most common way to get an empty or missing-host answer.',
      'SSH rows include the detected remote platform after that target has connected (linux, darwin, or win32); disconnected or older targets report platform unknown.',
      'SSH rows also include whether the target is currently connected and its lifecycle status when known.',
      "SSH targets are read from this machine's own Kolux runtime, so this lists that machine's targets and not another server's. Run `kolux host list` on the other machine to see the targets registered there.",
      '--environment and --pairing-code are rejected rather than ignored: paired servers come from this machine\u2019s pairing store, so a routed answer would describe two machines at once.'
    ],
    examples: ['kolux host list', 'kolux host list --json']
  },
  {
    path: ['environment', 'add'],
    summary: 'Save a remote Kolux runtime environment from a pairing code',
    usage: 'kolux environment add --name <name> --pairing-code <code> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'name'],
    examples: ['kolux environment add --name work-laptop --pairing-code kolux://pair?code=...']
  },
  {
    path: ['environment', 'list'],
    summary: 'List saved Kolux runtime environments',
    usage: 'kolux environment list [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Answers from this machine\u2019s pairing store. --environment and --pairing-code are rejected rather than ignored, because there is no other host that could answer.'
    ]
  },
  {
    path: ['environment', 'show'],
    summary: 'Show one saved Kolux runtime environment',
    usage: 'kolux environment show --environment <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['environment', 'rm'],
    destructive: true,
    summary: 'Remove one saved Kolux runtime environment',
    usage: 'kolux environment rm --environment <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  }
]
