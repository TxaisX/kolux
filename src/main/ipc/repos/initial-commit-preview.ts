import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { DEFAULT_GITIGNORE_CONTENT, LARGE_FILE_BYTES_THRESHOLD, looksLikeSecretFile } from './initial-commit-defaults'
import type {
  InitialCommitPreviewFile,
  InitialCommitPreviewResult
} from '../../../shared/repo-git-publish-types'

// Why: a huge untracked tree (this flow targets arbitrary personal folders, e.g.
// Documents) must not stat forever. Files beyond this count are omitted, not
// swallowed silently — `truncated` says so.
const MAX_PREVIEW_FILES = 5000

/**
 * What `git add -A && git commit` would stage right now, honoring the repo's real
 * .gitignore when one exists, or simulating the proposed default when it doesn't —
 * without ever writing that default to disk. Read-only.
 */
export async function computeInitialCommitPreview(
  repoPath: string
): Promise<InitialCommitPreviewResult> {
  const gitignoreExists = existsSync(join(repoPath, '.gitignore'))
  let tempExcludeFile: string | null = null
  const excludeArgs: string[] = []
  if (!gitignoreExists) {
    const dir = await mkdtemp(join(tmpdir(), 'nightshift-gitignore-'))
    tempExcludeFile = join(dir, 'default.gitignore')
    await writeFile(tempExcludeFile, DEFAULT_GITIGNORE_CONTENT, 'utf-8')
    excludeArgs.push(`--exclude-from=${tempExcludeFile}`)
  }
  try {
    const { stdout } = await gitExecFileAsync(
      ['ls-files', '--others', '--exclude-standard', ...excludeArgs, '-z'],
      { cwd: repoPath }
    )
    const relativePaths = stdout.split('\0').filter(Boolean)
    const truncated = relativePaths.length > MAX_PREVIEW_FILES
    const consideredPaths = truncated ? relativePaths.slice(0, MAX_PREVIEW_FILES) : relativePaths

    const files: InitialCommitPreviewFile[] = []
    for (const relativePath of consideredPaths) {
      let size = 0
      try {
        size = (await stat(join(repoPath, relativePath))).size
      } catch {
        continue // vanished between listing and stat — skip rather than fail the whole preview
      }
      const flags: InitialCommitPreviewFile['flags'] = {}
      if (size > LARGE_FILE_BYTES_THRESHOLD) {
        flags.large = true
      }
      if (looksLikeSecretFile(basename(relativePath))) {
        flags.secret = true
      }
      files.push({ path: relativePath, size, flags })
    }

    return {
      files,
      totalCount: relativePaths.length,
      truncated,
      hasWarnings: files.some((file) => file.flags.secret || file.flags.large),
      gitignoreExists
    }
  } finally {
    if (tempExcludeFile) {
      await rm(dirname(tempExcludeFile), { recursive: true, force: true }).catch(() => {})
    }
  }
}
