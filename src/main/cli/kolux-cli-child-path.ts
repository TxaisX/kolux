/**
 * The PATH entry through which a Kolux-launched child reaches THIS app's own CLI.
 *
 * Extracted from `buildPtyHostEnv` so the structured-session lane can apply the identical
 * treatment. A structured worker has no PTY, but its provider child runs `kolux orchestration ...`
 * exactly like a PTY worker's agent does, and it was inheriting the ambient PATH instead. On
 * packaged Linux that made bare `kolux` resolve to GNOME's /usr/bin/orca screen reader, because
 * Kolux's Linux CLI installs as `kolux-ide` to avoid claiming that name (TxaisX/kolux#7904); on
 * packaged macOS/Windows it reached this app's bundled CLI only if the user had separately
 * registered the CLI globally.
 *
 * `platform` is a test seam only: production leaves it unset and reads `process.platform`, so
 * every branch behaves exactly as it did inside `buildPtyHostEnv`.
 */

import { join } from 'node:path'
import { readInheritedPath } from '../ipc/pty/host-env/path'
import { resolvePathEnvKey } from '../pty/windows-environment-path'
import { ensureLinuxTerminalKoluxCliShimDir } from './linux-terminal-kolux-cli-shim'

export type KoluxCliChildPathOptions = {
  isPackaged: boolean
  userDataPath: string
  resourcesPath?: string | null
  /** Test seam — production reads the real platform, which is what every branch below assumes. */
  platform?: NodeJS.Platform
}

/** Mutates `env` in place, prepending the directory that makes bare `kolux` this app's CLI. */
export function prependKoluxCliDirToChildPath(
  env: Record<string, string>,
  opts: KoluxCliChildPathOptions
): void {
  const platform = opts.platform ?? process.platform
  // Why: delimiter for the TARGET platform, not the host running this code — node:path's own
  // `delimiter` reflects the host and broke the seam for tests driving a foreign platform.
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  // Why: dev mode needs the launcher PATH override so `kolux` resolves to the dev build instead of the production binary at /usr/local/bin/kolux.
  if (!opts.isPackaged) {
    const devCliBin = join(opts.userDataPath, 'cli', 'bin')
    const inheritedPath = readInheritedPath(env, platform)
    // Why: an empty PATH segment resolves as `.` in some shells (commands run from cwd); avoid a trailing delimiter.
    env[resolvePathEnvKey(env, platform)] = inheritedPath
      ? `${devCliBin}${pathDelimiter}${inheritedPath}`
      : devCliBin
  } else if (platform === 'linux') {
    // Why: bare-`kolux` shim scoped to Kolux PTYs — Linux CLI installs as `kolux-ide` to avoid shadowing GNOME's /usr/bin/orca screen reader (TxaisX/kolux#7904).
    const shimDir = ensureLinuxTerminalKoluxCliShimDir({ userDataPath: opts.userDataPath })
    if (shimDir) {
      const inheritedEntries = readInheritedPath(env, platform)
        .split(pathDelimiter)
        .filter((entry) => entry.length > 0 && entry !== shimDir)
      env.PATH = [shimDir, ...inheritedEntries].join(pathDelimiter)
    }
  } else if (opts.resourcesPath && (platform === 'darwin' || platform === 'win32')) {
    // Why: global CLI registration is optional, but agents in Kolux-managed PTYs must always reach this app's bundled CLI.
    const bundledCliBin = join(opts.resourcesPath, 'bin')
    const inheritedPath = readInheritedPath(env, platform)
    env[resolvePathEnvKey(env, platform)] = inheritedPath
      ? `${bundledCliBin}${pathDelimiter}${inheritedPath}`
      : bundledCliBin
  }
}
