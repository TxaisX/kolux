// Why: `.kolux/issue-command` is the per-user override; `kolux.yaml` is the tracked project default.
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { loadHooks } from './hooks'
import { KOLUX_REPO_DIR_NAME, LEGACY_NIGHTSHIFT_REPO_DIR_NAME } from '../shared/kolux-repo-dir'

const KOLUX_DIR = KOLUX_REPO_DIR_NAME
const ISSUE_COMMAND_FILENAME = 'issue-command'

export function getIssueCommandFilePath(repoPath: string): string {
  return join(repoPath, KOLUX_DIR, ISSUE_COMMAND_FILENAME)
}

/** Read location for the issue-command override: kolux.yaml's dir, falling back to the legacy .nightshift dir. */
function resolveIssueCommandReadPath(repoPath: string): string {
  const preferred = getIssueCommandFilePath(repoPath)
  if (existsSync(preferred)) {
    return preferred
  }
  const legacy = join(repoPath, LEGACY_NIGHTSHIFT_REPO_DIR_NAME, ISSUE_COMMAND_FILENAME)
  return existsSync(legacy) ? legacy : preferred
}

export function getSharedIssueCommand(repoPath: string): string | null {
  return loadHooks(repoPath)?.issueCommand?.trim() || null
}

export type ResolvedIssueCommand = {
  localContent: string | null
  sharedContent: string | null
  effectiveContent: string | null
  localFilePath: string
  source: 'local' | 'shared' | 'none'
}

/**
 * Resolve the GitHub issue command using local override first, then tracked repo config.
 */
export function readIssueCommand(repoPath: string): ResolvedIssueCommand {
  const filePath = resolveIssueCommandReadPath(repoPath)
  let localContent: string | null = null

  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8').trim()
      localContent = content || null
    } catch {
      localContent = null
    }
  }

  const sharedContent = getSharedIssueCommand(repoPath)
  const effectiveContent = localContent ?? sharedContent

  return {
    localContent,
    sharedContent,
    effectiveContent,
    localFilePath: filePath,
    source: localContent ? 'local' : sharedContent ? 'shared' : 'none'
  }
}

/**
 * Write the per-user issue command override to `{repoRoot}/.kolux/issue-command`.
 * Empty content deletes the override so the shared `kolux.yaml` command applies again.
 */
export function writeIssueCommand(repoPath: string, content: string): void {
  const filePath = getIssueCommandFilePath(repoPath)
  const trimmed = content.trim()

  try {
    if (!trimmed) {
      rmSync(filePath, { force: true })
      return
    }

    const koluxDir = join(repoPath, KOLUX_DIR)
    if (!existsSync(koluxDir)) {
      mkdirSync(koluxDir, { recursive: true })
    }
    ensureKoluxDirIgnored(repoPath)
    writeFileSync(filePath, `${trimmed}\n`, 'utf-8')
  } catch (err) {
    console.error('[hooks] Failed to write issue command:', err)
    // Why: re-throw so the IPC handler surfaces the write failure to the renderer's .catch().
    throw err
  }
}

/** Ensure `.kolux` is in `.gitignore` so the per-user directory is never committed. */
function ensureKoluxDirIgnored(repoPath: string): void {
  const gitignorePath = join(repoPath, '.gitignore')
  try {
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8')
      if (/^\.kolux\/?$/m.test(content)) {
        return
      }
      const separator = content.endsWith('\n') ? '' : '\n'
      writeFileSync(gitignorePath, `${content}${separator}.kolux\n`, 'utf-8')
    } else {
      writeFileSync(gitignorePath, '.kolux\n', 'utf-8')
    }
  } catch {
    console.warn('[hooks] Could not update .gitignore to exclude .kolux')
  }
}
