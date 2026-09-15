import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { writeFileAtomically } from './codex-accounts/fs-utils'
import { ClaudeRuntimePathResolver } from './claude-accounts/runtime-paths'

/**
 * Claude Code keeps per-project trust in `.claude.json` (inside CLAUDE_CONFIG_DIR when that is
 * set, else in the home directory) under `projects["<absolute path>"].hasTrustDialogAccepted`.
 * Pre-writing it skips the "Do you trust this folder?" menu that otherwise holds a launch
 * prompt hostage on every fresh worktree. Fork addition: upstream ships presets for Cursor,
 * Copilot and Codex only.
 *
 * Trust does not inherit from a trusted parent directory here: Claude's own upward trust walk
 * stops at the nearest ancestor holding a `.git` entry, and every `git worktree add` checkout
 * has its own `.git` file, so it never reaches a shared grandparent folder that holds several
 * worktrees. Each worktree needs its own entry (verified against the Claude Code 2.1.270 CLI
 * bundle: the walk in `NH()`/`DH()` is bounded by `yx()`, which finds the nearest `.git`).
 *
 * Why the batching below: a freshly spawned `claude` process reads this whole file at startup
 * and later flushes its own copy back (it carries session-global fields like `numStartups` and
 * generated IDs), using whatever it read at launch. Launching a wave of worktrees used to write
 * trust for worktree N and spawn its `claude` immediately, before worktree N+1's entry existed;
 * if that earlier process's own flush lands after N+1..6 were written, it silently drops them
 * from the file before those siblings ever get to check it (reproduced in
 * scratchpad/race-sim.js). Collecting every mark that arrives within a short window and writing
 * them in one pass closes that gap: whichever process reads first still sees every sibling's
 * entry, so its later flush cannot lose them.
 */
const WAVE_COLLECTION_WINDOW_MS = 250

let pendingWaiters: Map<string, (() => void)[]> | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function markClaudeProjectTrusted(workspacePath: string): Promise<void> {
  const absPath = canonicalizeClaudeProjectPath(workspacePath)
  if (isClaudeProjectAlreadyTrusted(absPath)) {
    return Promise.resolve()
  }
  return new Promise((resolveMark) => {
    pendingWaiters ??= new Map()
    const waiters = pendingWaiters.get(absPath) ?? []
    waiters.push(resolveMark)
    pendingWaiters.set(absPath, waiters)
    if (flushTimer) {
      clearTimeout(flushTimer)
    }
    flushTimer = setTimeout(flushPendingClaudeTrust, WAVE_COLLECTION_WINDOW_MS)
    // Why: an Electron main-process timer must never keep the app alive or block a test runner.
    flushTimer.unref?.()
  })
}

function flushPendingClaudeTrust(): void {
  const batch = pendingWaiters
  pendingWaiters = null
  flushTimer = null
  if (!batch || batch.size === 0) {
    return
  }
  writeClaudeProjectTrust([...batch.keys()])
  for (const waiters of batch.values()) {
    for (const resolveWaiter of waiters) {
      resolveWaiter()
    }
  }
}

/** Exported so a wave pre-trust can write every planned worktree path in one call, before any of
 *  them exists on disk or has spawned a `claude` process — see agent-trust-pretrust-worktrees.ts. */
export function writeClaudeProjectTrust(absPaths: readonly string[]): void {
  const configPath = new ClaudeRuntimePathResolver().getRuntimePaths().configPath
  let config: Record<string, unknown> = {}
  try {
    if (existsSync(configPath)) {
      const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf-8'))
      if (parsed && typeof parsed === 'object') {
        config = parsed as Record<string, unknown>
      }
    }
  } catch {
    // Why: a corrupted config is the user's to fix; never overwrite it from a side effect.
    return
  }
  const projects =
    config.projects && typeof config.projects === 'object'
      ? (config.projects as Record<string, Record<string, unknown>>)
      : {}
  let changed = false
  for (const absPath of absPaths) {
    const existing = projects[absPath]
    if (existing?.hasTrustDialogAccepted === true) {
      continue
    }
    projects[absPath] = { allowedTools: [], ...existing, hasTrustDialogAccepted: true }
    changed = true
  }
  if (!changed) {
    return
  }
  config.projects = projects
  writeFileAtomically(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

function isClaudeProjectAlreadyTrusted(absPath: string): boolean {
  const configPath = new ClaudeRuntimePathResolver().getRuntimePaths().configPath
  try {
    if (!existsSync(configPath)) {
      return false
    }
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') {
      return false
    }
    const projects = (parsed as Record<string, unknown>).projects
    if (!projects || typeof projects !== 'object') {
      return false
    }
    const entry = (projects as Record<string, Record<string, unknown>>)[absPath]
    return entry?.hasTrustDialogAccepted === true
  } catch {
    return false
  }
}

/** Exported so a wave pre-trust can key its planned paths the same way a per-spawn mark would once
 *  the worktree exists — see agent-trust-pretrust-worktrees.ts. */
export function canonicalizeClaudeProjectPath(workspacePath: string): string {
  const absPath = resolve(workspacePath)
  try {
    // Why: Claude keys the entry on process.cwd(), which Windows reports with the on-disk casing.
    return toClaudeProjectKey(realpathSync.native(absPath))
  } catch {
    // Why: a wave pre-trust plans a path before `git worktree add` creates it, so the full path
    // never realpath()s. Resolve the nearest existing ancestor (workspace root, repo dir, ...) to
    // on-disk casing and rejoin the not-yet-created segments verbatim -- `mkdir` will create them
    // with exactly that casing, so the key still matches what Claude sees once it exists.
    return toClaudeProjectKey(canonicalizeAgainstNearestExistingAncestor(absPath))
  }
}

/**
 * Claude normalizes project keys with `d1()`: `path.normalize`, then on Windows every `\` becomes
 * `/` (Claude Code 2.1.270 bundle). A backslash key is never looked up, so writing one leaves the
 * trust menu up; verified live when six trusted backslash entries still prompted.
 */
export function toClaudeProjectKey(
  absPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32' ? absPath.replaceAll('\\', '/') : absPath
}

function canonicalizeAgainstNearestExistingAncestor(absPath: string): string {
  const trailingSegments: string[] = []
  let current = absPath
  for (;;) {
    if (existsSync(current)) {
      try {
        return join(realpathSync.native(current), ...trailingSegments.toReversed())
      } catch {
        return absPath
      }
    }
    const parent = dirname(current)
    if (parent === current) {
      // Why: reached the filesystem root without finding anything real; keep the raw path.
      return absPath
    }
    trailingSegments.push(basename(current))
    current = parent
  }
}
