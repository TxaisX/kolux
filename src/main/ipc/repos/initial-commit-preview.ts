import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { mapWithConcurrency } from '../../../shared/map-with-concurrency'
import { DEFAULT_GITIGNORE_CONTENT, LARGE_FILE_BYTES_THRESHOLD, looksLikeSecretFile } from './initial-commit-defaults'
import type {
  InitialCommitPreviewFile,
  InitialCommitPreviewResult
} from '../../../shared/repo-git-publish-types'

// Why: the displayed list is capped so a huge untracked tree (this flow targets arbitrary
// personal folders, e.g. Documents) doesn't render forever — but secret/large flags are
// always computed over the FULL list first, so a flagged file past this cutoff still blocks
// the commit. `truncated` says the display was cut; `flaggedCount` says how many total.
const MAX_PREVIEW_FILES = 5000
// Why: bound concurrent `stat` calls so a huge tree doesn't open thousands of file handles at once.
const STAT_CONCURRENCY = 64

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

    // Flags are computed over every path — secret/large detection must never be skipped
    // just because a file sorts past the display cutoff.
    const allFiles: InitialCommitPreviewFile[] = await mapWithConcurrency(
      relativePaths,
      STAT_CONCURRENCY,
      async (relativePath): Promise<InitialCommitPreviewFile> => {
        let size = 0
        try {
          size = (await stat(join(repoPath, relativePath))).size
        } catch {
          // vanished between listing and stat — report as a zero-byte entry rather than
          // dropping it, so a secret-named file that briefly disappears still flags.
        }
        const flags: InitialCommitPreviewFile['flags'] = {}
        if (size > LARGE_FILE_BYTES_THRESHOLD) {
          flags.large = true
        }
        if (looksLikeSecretFile(basename(relativePath))) {
          flags.secret = true
        }
        return { path: relativePath, size, flags }
      }
    )

    const isFlagged = (file: InitialCommitPreviewFile): boolean =>
      Boolean(file.flags.secret || file.flags.large)
    const flaggedCount = allFiles.reduce((count, file) => count + (isFlagged(file) ? 1 : 0), 0)
    const truncated = allFiles.length > MAX_PREVIEW_FILES
    // Flagged files are shown first so truncation never hides them past the display cutoff.
    const displayFiles = truncated
      ? [...allFiles.filter(isFlagged), ...allFiles.filter((file) => !isFlagged(file))].slice(
          0,
          MAX_PREVIEW_FILES
        )
      : allFiles

    return {
      files: displayFiles,
      totalCount: relativePaths.length,
      truncated,
      hasWarnings: flaggedCount > 0,
      flaggedCount,
      gitignoreExists
    }
  } finally {
    if (tempExcludeFile) {
      await rm(dirname(tempExcludeFile), { recursive: true, force: true }).catch(() => {})
    }
  }
}
