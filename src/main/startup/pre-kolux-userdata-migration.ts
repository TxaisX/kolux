/**
 * One-time, idempotent, crash-safe carry-forward of on-disk state an old Nightshift-named
 * build wrote, into the new Kolux-named locations (the product was renamed Nightshift -> Kolux).
 *
 * Must run before anything else reads userData — see main-process-preflight.ts — and before
 * the CLI resolves its own userData path, since CLI hook commands can run before the app ever
 * launches post-upgrade.
 *
 * Design: always recurse and translate per-entry rather than renaming whole directories wholesale,
 * because filenames themselves changed (nightshift-data.json -> kolux-data.json) alongside the
 * folder names. A same-volume rename() on each file is still just a metadata operation, so this
 * costs no more than a bulk directory rename would. Never clobbers an existing new-side file/dir,
 * and never deletes old data — rename() empties the source as an atomic side effect, but the old
 * root directory itself is left in place for the user/uninstaller.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'

const MIGRATION_COMPLETE_MARKER = '.kolux-legacy-rename-migration-complete'
// Mirrors LEGACY_BACKUP_COUNT in kolux-profiles/profile-storage-paths.ts.
const LEGACY_BACKUP_COUNT = 5

function buildBasenameRenameMap(): ReadonlyMap<string, string> {
  const map = new Map<string, string>([
    ['nightshift-data.json', 'kolux-data.json'],
    ['nightshift-profile-index.json', 'kolux-profile-index.json'],
    ['nightshift-runtime.json', 'kolux-runtime.json'],
    ['nightshift-github-cache.json', 'kolux-github-cache.json'],
    ['nightshift-stats.json', 'kolux-stats.json'],
    ['nightshift-claude-usage.json', 'kolux-claude-usage.json'],
    ['nightshift-codex-usage.json', 'kolux-codex-usage.json'],
    ['nightshift-devices.json', 'kolux-devices.json'],
    ['nightshift-e2ee-keypair.json', 'kolux-e2ee-keypair.json'],
    ['nightshift-relay-region-preference.json', 'kolux-relay-region-preference.json'],
    ['nightshift-environments.json', 'kolux-environments.json'],
    ['nightshift-ephemeral-vm-runtimes.json', 'kolux-ephemeral-vm-runtimes.json'],
    ['nightshift-ephemeral-vm-runtime-features.json', 'kolux-ephemeral-vm-runtime-features.json'],
    ['nightshift-local-build.json', 'kolux-local-build.json'],
    ['nightshift-secret-protection.json', 'kolux-secret-protection.json'],
    ['nightshift-workspace-cleanup-scan.json', 'kolux-workspace-cleanup-scan.json'],
    ['nightshift-workspace-space-analysis.json', 'kolux-workspace-space-analysis.json'],
    ['nightshiftd.lock', 'koluxd.lock'],
    // Markers inside dirs this migration owns (managed homes live under userData / ~/.kolux).
    ['.nightshift-managed-home', '.kolux-managed-home'],
    ['.nightshift-managed-claude-auth', '.kolux-managed-claude-auth'],
    ['.nightshift-session-copies', '.kolux-session-copies'],
    ['.nightshift-resource-copies', '.kolux-resource-copies'],
    ['.nightshift-config-settings-baseline.json', '.kolux-config-settings-baseline.json'],
    ['.nightshift-hook-trust-provenance.json', '.kolux-hook-trust-provenance.json'],
    ['.nightshift-shell-wrapper', '.kolux-shell-wrapper'],
    ['.nightshift-pi-overlay-manifest.json', '.kolux-pi-overlay-manifest.json'],
    ['.nightshift-omp-overlay-migration-complete', '.kolux-omp-overlay-migration-complete'],
    // Electron strips the `persist:` prefix from a session partition name on disk.
    ['nightshift-browser', 'kolux-browser']
  ])
  for (let index = 1; index <= LEGACY_BACKUP_COUNT; index += 1) {
    map.set(`nightshift-data.json.bak.${index}`, `kolux-data.json.bak.${index}`)
  }
  return map
}

const BASENAME_RENAME_MAP = buildBasenameRenameMap()

// Suffix-preserving renames for names with an id/counter tail the exact map above can't enumerate.
const BASENAME_PREFIX_RENAMES: readonly [RegExp, string][] = [
  [/^\.nightshift-legacy-(.+)$/, '.kolux-legacy-$1'],
  [/^nightshift-browser-session-(.+)$/, 'kolux-browser-session-$1']
]

function translatedBasename(name: string): string {
  const exact = BASENAME_RENAME_MAP.get(name)
  if (exact) {
    return exact
  }
  for (const [pattern, replacement] of BASENAME_PREFIX_RENAMES) {
    if (pattern.test(name)) {
      return name.replace(pattern, replacement)
    }
  }
  return name
}

// Why: a relative symlink target can name a sibling this migration itself renames (e.g.
// '.nightshift-managed-home'); carrying the raw target forward verbatim would leave the new
// link pointing at a name that only ever existed on the old side, so translate each path
// segment the same way a real entry's basename would be translated. An absolute target is left
// untouched — it may point outside the migrated tree entirely, and rewriting it would risk
// aiming at a path this migration never created.
export function translatedSymlinkTarget(rawTarget: string): string {
  if (isAbsolute(rawTarget)) {
    return rawTarget
  }
  return rawTarget
    .split(/([\\/])/)
    .map((part) =>
      part === '' || part === '.' || part === '..' || /^[\\/]$/.test(part)
        ? part
        : translatedBasename(part)
    )
    .join('')
}

function moveOrCopyFile(oldPath: string, newPath: string): boolean {
  try {
    renameSync(oldPath, newPath)
    return true
  } catch {
    // Why: EBUSY/EPERM means the old app (or its daemon) still has this file open; EXDEV means
    // the two roots are on different volumes. Either way, fall back to copying instead of
    // losing it, and leave the source alone so a still-running old build keeps working.
  }
  try {
    cpSync(oldPath, newPath, { errorOnExist: true, force: false, preserveTimestamps: true })
    return true
  } catch (error) {
    console.warn('[legacy-rename-migration] Failed to carry forward', oldPath, error)
    return false
  }
}

function migrateEntry(oldPath: string, newPath: string, entry: Dirent): boolean {
  if (existsSync(newPath)) {
    // Never clobber; only a directory is worth descending into for children still missing.
    return entry.isDirectory() ? migrateDirectoryContents(oldPath, newPath) : true
  }
  if (entry.isSymbolicLink()) {
    try {
      symlinkSync(translatedSymlinkTarget(readlinkSync(oldPath)), newPath)
      return true
    } catch (error) {
      console.warn('[legacy-rename-migration] Failed to carry forward symlink', oldPath, error)
      return false
    }
  }
  if (entry.isDirectory()) {
    try {
      mkdirSync(newPath, { recursive: true })
    } catch (error) {
      console.warn('[legacy-rename-migration] Failed to create', newPath, error)
      return false
    }
    return migrateDirectoryContents(oldPath, newPath)
  }
  if (!entry.isFile()) {
    // Nothing this migration owns should ever be a socket/device/etc.; not a failure to skip one.
    return true
  }
  return moveOrCopyFile(oldPath, newPath)
}

function migrateDirectoryContents(oldDir: string, newDir: string): boolean {
  let entries: Dirent[]
  try {
    entries = readdirSync(oldDir, { withFileTypes: true })
  } catch {
    // Gone or unreadable between the existence check and here: nothing left to migrate.
    return true
  }
  let allSucceeded = true
  for (const entry of entries) {
    const oldPath = join(oldDir, entry.name)
    const newPath = join(newDir, translatedBasename(entry.name))
    if (!migrateEntry(oldPath, newPath, entry)) {
      allSucceeded = false
    }
  }
  return allSucceeded
}

type LegacyDirectoryPair = { oldDir: string; newDir: string }

function candidateDirectoryPairs(
  canonicalUserDataPath: string,
  home: string
): LegacyDirectoryPair[] {
  const pairs: LegacyDirectoryPair[] = []
  const rootName = basename(canonicalUserDataPath).toLowerCase()
  // Why: dev (kolux-dev) and E2E roots run beside a live Nightshift install on a developer
  // machine; carrying ~/.nightshift forward from there pulls hooks out from under that app.
  if (rootName !== 'kolux' && rootName !== '.kolux') {
    return pairs
  }
  const appDataRoot = dirname(canonicalUserDataPath)
  // Why gated on the packaged name (case-insensitively): a dev/E2E override (kolux-dev, a
  // disposable E2E dir) is not a real user's install and must never pull another profile's
  // data into it. Case-insensitive because the CLI's own userData resolver (getDefaultUserDataPath
  // in cli/runtime/metadata.ts) can call this with a lowercase 'kolux' basename before the
  // Electron app has ever launched post-upgrade.
  if (rootName === 'kolux') {
    pairs.push({ oldDir: join(appDataRoot, 'Nightshift'), newDir: canonicalUserDataPath })
    // Why also the lowercase form: CLI/hook code (cli/runtime/metadata.ts,
    // codex/codex-home-paths.ts) resolves userData independently of Electron using a
    // lowercase folder name — a distinct directory from the capitalized one on
    // case-sensitive filesystems (Linux, and non-default case-sensitive APFS). A harmless
    // no-op pass on case-insensitive filesystems, where it is the same physical directory.
    pairs.push({ oldDir: join(appDataRoot, 'nightshift'), newDir: canonicalUserDataPath })
  }
  // Why for both root names: ~/.kolux is a dotfile home built independently of userData (agent
  // hooks, keybindings.json, credential stores, claude-agent-teams-bin, relay sessions).
  pairs.push({ oldDir: join(home, '.nightshift'), newDir: join(home, '.kolux') })
  const xdgDataHome = process.env.XDG_DATA_HOME
  if (xdgDataHome) {
    // Why: koluxd-app-paths.ts resolves koluxd's data root to $XDG_DATA_HOME/Kolux when set
    // — a third directory, distinct from both userData forms above.
    pairs.push({ oldDir: join(xdgDataHome, 'Nightshift'), newDir: join(xdgDataHome, 'Kolux') })
  }
  return pairs
}

/**
 * Runs the carry-forward. Fast when there is nothing to do: one stat for the completion marker.
 *
 * Only marks the migration complete once every candidate directory pair fully succeeded, so a
 * failure left by a still-running old app (or a locked file) is retried on the next launch
 * instead of being silently accepted as done.
 */
export function migrateLegacyNightshiftUserData(
  canonicalUserDataPath: string,
  options: { homeDir?: string } = {}
): void {
  // Why: under a test runner homedir() and the default AppData are the developer's live install;
  // only an explicitly supplied sandbox home may be migrated (this once moved a real profile).
  if (process.env.VITEST && !options.homeDir) {
    return
  }
  const markerPath = join(canonicalUserDataPath, MIGRATION_COMPLETE_MARKER)
  if (existsSync(markerPath)) {
    return
  }
  let allSucceeded = true
  const home = options.homeDir ?? homedir()
  for (const { oldDir, newDir } of candidateDirectoryPairs(canonicalUserDataPath, home)) {
    if (!existsSync(oldDir)) {
      continue
    }
    try {
      mkdirSync(newDir, { recursive: true })
    } catch (error) {
      console.warn('[legacy-rename-migration] Failed to create', newDir, error)
      allSucceeded = false
      continue
    }
    if (!migrateDirectoryContents(oldDir, newDir)) {
      allSucceeded = false
    }
  }
  if (!allSucceeded) {
    return
  }
  try {
    mkdirSync(canonicalUserDataPath, { recursive: true })
    writeFileSync(markerPath, `${JSON.stringify({ migratedAt: Date.now() })}\n`)
  } catch (error) {
    console.warn('[legacy-rename-migration] Failed to write completion marker:', error)
  }
}
