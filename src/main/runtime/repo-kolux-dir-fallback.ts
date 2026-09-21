// Why: single choke point for reading a file under a repo's .kolux/ dir over an fsProvider,
// falling back to the pre-rename .nightshift/ dir. Writes always go to .kolux/ (not handled here).
import { KOLUX_REPO_DIR_NAME, LEGACY_NIGHTSHIFT_REPO_DIR_NAME } from '../../shared/kolux-repo-dir'
import { isENOENT } from '../ipc/filesystem-path-containment'
import type { IFilesystemProvider } from '../providers/filesystem-provider-contract'
import { joinWorktreeRelativePath } from './runtime-relative-paths'

/** Read `{repoPath}/.kolux/{subPath}` over an fsProvider, falling back to `.nightshift/{subPath}`. Null when neither exists. */
export async function readRepoKoluxDirFile(
  fsProvider: IFilesystemProvider,
  repoPath: string,
  subPath: string
): Promise<string | null> {
  try {
    const result = await fsProvider.readFile(
      joinWorktreeRelativePath(repoPath, `${KOLUX_REPO_DIR_NAME}/${subPath}`)
    )
    return result.isBinary ? null : result.content.trim() || null
  } catch (error) {
    if (!isENOENT(error)) {
      return null
    }
  }
  try {
    const result = await fsProvider.readFile(
      joinWorktreeRelativePath(repoPath, `${LEGACY_NIGHTSHIFT_REPO_DIR_NAME}/${subPath}`)
    )
    return result.isBinary ? null : result.content.trim() || null
  } catch {
    return null
  }
}
