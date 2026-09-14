import { gitExecFileAsync } from '../../git/runner'

/** `git remote` prints one configured remote name per line; empty output means none. */
export async function repoHasAnyRemote(repoPath: string): Promise<boolean> {
  const { stdout } = await gitExecFileAsync(['remote'], { cwd: repoPath })
  return stdout.split(/\r?\n/).some((line) => line.trim().length > 0)
}
