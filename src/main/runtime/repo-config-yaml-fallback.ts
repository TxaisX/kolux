// Why: single choke point for reading a remote repo's project-config yaml with a fallback to the
// pre-rename nightshift.yaml, used by every runtime/IPC path that reads it over an fsProvider.
import {
  KOLUX_YAML_FILENAME,
  LEGACY_NIGHTSHIFT_YAML_FILENAME
} from '../../shared/kolux-yaml-file-resolution'
import { isENOENT } from '../ipc/filesystem-path-containment'
import type { FileReadResult, IFilesystemProvider } from '../providers/filesystem-provider-contract'
import { joinWorktreeRelativePath } from './runtime-relative-paths'

/** Read a repo's kolux.yaml over an fsProvider, falling back to nightshift.yaml. Null when neither exists. */
export async function readRepoConfigYaml(
  fsProvider: IFilesystemProvider,
  repoPath: string
): Promise<FileReadResult | null> {
  try {
    return await fsProvider.readFile(joinWorktreeRelativePath(repoPath, KOLUX_YAML_FILENAME))
  } catch (error) {
    if (!isENOENT(error)) {
      throw error
    }
  }
  try {
    return await fsProvider.readFile(
      joinWorktreeRelativePath(repoPath, LEGACY_NIGHTSHIFT_YAML_FILENAME)
    )
  } catch (error) {
    if (!isENOENT(error)) {
      throw error
    }
    return null
  }
}
