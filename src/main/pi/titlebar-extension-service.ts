import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import { createHash } from 'node:crypto'
import {
  KOLUX_PI_AGENT_STATUS_EXTENSION_FILE,
  getPiAgentStatusExtensionSource
} from './agent-status-extension-source'
import {
  KOLUX_PI_PREFILL_EXTENSION_FILE,
  getPiPrefillExtensionSource
} from './prefill-extension-source'
import { KOLUX_PI_EXTENSION_FILE, getPiTitlebarExtensionSource } from './titlebar-extension-source'
import {
  isSafeDescendCandidate as sharedIsSafeDescendCandidate,
  safeRemoveOverlay
} from '../pty/overlay-mirror'
import { migrateLegacyOmpOverlayState } from './legacy-omp-overlay-migration'
import type { PiAgentKind } from '../../shared/pi-agent-kind'

// Why: the Pi test suite imports `isSafeDescendCandidate` from this module's
// public surface to lock in the Windows-junction ordering invariant against
// future refactors. Re-export the shared implementation so the test contract
// keeps holding after the helper moved to src/main/pty/overlay-mirror.ts.
export const isSafeDescendCandidate = sharedIsSafeDescendCandidate

const PI_AGENT_SUBDIR = 'agent'
const KOLUX_MANAGED_EXTENSION_MARKER = '@kolux-managed-pi-extension'
const OMP_MANAGED_STATUS_EXTENSION_DIR = 'omp-managed-status-extension'

// Why: Pi/OMP loads every extensions/*.ts file. A pre-rename kolux-*.ts extension named
// nightshift-*.ts would keep firing the managed hook a second time under its old filename.
const PRE_RENAME_MANAGED_EXTENSION_MARKER = '@nightshift-managed-pi-extension'
const PRE_RENAME_MANAGED_EXTENSION_FILES = [
  'nightshift-titlebar-spinner.ts',
  'nightshift-prefill.ts',
  'nightshift-agent-status.ts'
]

function sweepLegacyManagedExtensions(extensionsDir: string): void {
  for (const fileName of PRE_RENAME_MANAGED_EXTENSION_FILES) {
    const legacyPath = join(extensionsDir, fileName)
    try {
      if (readFileSync(legacyPath, 'utf8').includes(PRE_RENAME_MANAGED_EXTENSION_MARKER)) {
        unlinkSync(legacyPath)
      }
    } catch {
      // Absent or unreadable is the common case; best-effort sweep only.
    }
  }
}

type ManagedExtensionWriteResult = 'written' | 'skipped-user-owned' | 'failed'

type PiManagedExtensionEnv = {
  extensionDir?: string
  sourceAgentDir: string
  statusExtensionPath?: string
}

type LegacyOverlayAgentKind = Exclude<PiAgentKind, 'prime-agent'>

// Why: old Kolux versions used per-kind overlay roots. Keep the names so
// upgrade-time cleanup can remove stale PTY-scoped Pi/OMP overlay dirs without
// guessing which agent a terminated pane launched.
const OVERLAY_ROOT_DIR_NAME: Record<LegacyOverlayAgentKind, string> = {
  pi: 'pi-agent-overlays',
  omp: 'omp-agent-overlays'
}

// Why: the managed extension target is chosen by which agent is being launched, NOT
// by which `~/.<agent>/agent` dir happens to exist on disk first. A
// cross-agent fallback (Pi -> OMP or vice versa) silently shadows the other
// agent's user extensions when both are installed and the user picks the
// shadowed one in Kolux's per-launch agent picker.
const AGENT_HOME_DIR_NAME: Record<PiAgentKind, string> = {
  pi: '.pi',
  omp: '.omp',
  'prime-agent': '.prime'
}

function getDefaultPiAgentDir(kind: PiAgentKind): string {
  return join(homedir(), AGENT_HOME_DIR_NAME[kind], PI_AGENT_SUBDIR)
}

function toSafeOverlayDirName(ptyId: string): string {
  return createHash('sha256').update(ptyId).digest('hex').slice(0, 32)
}

function withKoluxManagedExtensionMarker(source: string): string {
  return source.includes(KOLUX_MANAGED_EXTENSION_MARKER)
    ? source
    : `// ${KOLUX_MANAGED_EXTENSION_MARKER}\n${source}`
}

export class PiTitlebarExtensionService {
  private getOverlayRoot(kind: LegacyOverlayAgentKind): string {
    return join(getAppEnvironment().getPath('userData'), OVERLAY_ROOT_DIR_NAME[kind])
  }

  private getSourceOverlayDir(sourceAgentDir: string, kind: LegacyOverlayAgentKind): string {
    // Why: builds before managed extensions stored Pi/OMP state in source-scoped
    // overlays. Resolve the old path so OMP upgrades can rescue stranded state.
    return join(this.getOverlayRoot(kind), toSafeOverlayDirName(`source:${sourceAgentDir}`))
  }

  private getPtyOverlayDir(ptyId: string, kind: LegacyOverlayAgentKind): string {
    // Why: old Kolux versions used PTY-scoped hashed overlays. Keep resolving
    // that path so new spawns/teardowns can clean stale pre-migration dirs.
    return join(this.getOverlayRoot(kind), toSafeOverlayDirName(ptyId))
  }

  private getLegacyOverlayDir(ptyId: string, kind: LegacyOverlayAgentKind): string {
    return join(this.getOverlayRoot(kind), ptyId)
  }

  // Why: overlay teardown must use the shared safeRemoveOverlay so the
  // Windows-junction guard from issue #1083 stays in lock-step across all
  // overlay consumers (Pi here, OpenCode in src/main/opencode/hook-service.ts).
  private safeRemoveOverlay(overlayDir: string, kind: LegacyOverlayAgentKind): void {
    safeRemoveOverlay(overlayDir, this.getOverlayRoot(kind))
  }

  private canOverwriteManagedExtension(path: string): boolean {
    try {
      return readFileSync(path, 'utf8').includes(KOLUX_MANAGED_EXTENSION_MARKER)
    } catch {
      return true
    }
  }

  private writeManagedExtension(path: string, source: string): ManagedExtensionWriteResult {
    if (existsSync(path) && !this.canOverwriteManagedExtension(path)) {
      return 'skipped-user-owned'
    }

    try {
      writeFileSync(path, source)
      return 'written'
    } catch {
      return 'failed'
    }
  }

  private writeOmpFallbackStatusExtension(source: string): string | undefined {
    const fallbackDir = join(
      getAppEnvironment().getPath('userData'),
      OMP_MANAGED_STATUS_EXTENSION_DIR
    )
    try {
      mkdirSync(fallbackDir, { recursive: true })
    } catch {
      return undefined
    }

    const fallbackPath = join(fallbackDir, KOLUX_PI_AGENT_STATUS_EXTENSION_FILE)
    return this.writeManagedExtension(fallbackPath, source) === 'written' ? fallbackPath : undefined
  }

  private installManagedExtensions(
    sourceAgentDir: string,
    kind: PiAgentKind
  ): PiManagedExtensionEnv {
    const extensionsDir = join(sourceAgentDir, 'extensions')
    try {
      mkdirSync(extensionsDir, { recursive: true })
    } catch {
      return { sourceAgentDir }
    }
    sweepLegacyManagedExtensions(extensionsDir)

    if (kind !== 'prime-agent') {
      this.writeManagedExtension(
        join(extensionsDir, KOLUX_PI_EXTENSION_FILE),
        withKoluxManagedExtensionMarker(getPiTitlebarExtensionSource(kind))
      )
      this.writeManagedExtension(
        join(extensionsDir, KOLUX_PI_PREFILL_EXTENSION_FILE),
        withKoluxManagedExtensionMarker(getPiPrefillExtensionSource(kind))
      )
    }
    const statusExtensionPath = join(extensionsDir, KOLUX_PI_AGENT_STATUS_EXTENSION_FILE)
    const statusSource = withKoluxManagedExtensionMarker(getPiAgentStatusExtensionSource(kind))
    const statusResult = this.writeManagedExtension(statusExtensionPath, statusSource)

    return {
      extensionDir: extensionsDir,
      sourceAgentDir,
      statusExtensionPath:
        statusResult === 'written'
          ? statusExtensionPath
          : kind === 'omp'
            ? this.writeOmpFallbackStatusExtension(statusSource)
            : undefined
    }
  }

  buildPtyEnv(
    ptyId: string,
    existingAgentDir: string | undefined,
    kind: PiAgentKind,
    options?: { materializeDefaultHome?: boolean }
  ): Record<string, string> {
    const sourceAgentDir = existingAgentDir || getDefaultPiAgentDir(kind)
    if (kind !== 'prime-agent') {
      try {
        this.safeRemoveOverlay(this.getPtyOverlayDir(ptyId, kind), kind)
        this.safeRemoveOverlay(this.getLegacyOverlayDir(ptyId, kind), kind)
      } catch {
        // Why: old per-PTY overlay cleanup is best-effort; a locked stale
        // directory should not prevent the terminal from starting.
      }
    }

    // Why: bare shells used to mkdir ~/.<agent>/agent for every terminal so a
    // later typed `pi`/`omp` got hooks. That recreates deleted unused agent
    // homes on every open (#10196). Only materialize the default home when the
    // caller opts in (explicit agent launch) or the dir already exists.
    const materializeDefaultHome = options?.materializeDefaultHome !== false
    if (!existsSync(sourceAgentDir) && !materializeDefaultHome) {
      if (kind === 'omp') {
        const statusSource = withKoluxManagedExtensionMarker(getPiAgentStatusExtensionSource(kind))
        const statusExtensionPath = this.writeOmpFallbackStatusExtension(statusSource)
        return statusExtensionPath ? { KOLUX_OMP_STATUS_EXTENSION: statusExtensionPath } : {}
      }
      return {}
    }

    if (kind === 'omp') {
      migrateLegacyOmpOverlayState(sourceAgentDir, this.getSourceOverlayDir(sourceAgentDir, 'omp'))
    }

    const installed = this.installManagedExtensions(sourceAgentDir, kind)
    const env: Record<string, string> = {}
    if (kind === 'omp') {
      env.KOLUX_OMP_SOURCE_AGENT_DIR = installed.sourceAgentDir
      if (installed.statusExtensionPath) {
        env.KOLUX_OMP_STATUS_EXTENSION = installed.statusExtensionPath
      }
    } else if (kind === 'prime-agent') {
      env.KOLUX_PRIME_AGENT_SOURCE_AGENT_DIR = installed.sourceAgentDir
    } else {
      env.KOLUX_PI_SOURCE_AGENT_DIR = installed.sourceAgentDir
    }
    return env
  }

  clearPty(ptyId: string): void {
    // Why: PTY teardown doesn't know which kind was launched (the daemon
    // exit path discards the launch command). Sweep both old PTY-scoped
    // overlay roots for migration cleanup. Source-scoped legacy overlays are
    // deliberately left in place so upgrades never delete user runtime state.
    for (const kind of Object.keys(OVERLAY_ROOT_DIR_NAME) as LegacyOverlayAgentKind[]) {
      try {
        this.safeRemoveOverlay(this.getPtyOverlayDir(ptyId, kind), kind)
        this.safeRemoveOverlay(this.getLegacyOverlayDir(ptyId, kind), kind)
      } catch {
        // Why: on Windows the overlay dir can be locked (EPERM/EBUSY) by
        // antivirus or indexers. Overlay cleanup is best-effort - a stale
        // old PTY-scoped directory in userData is harmless and will be
        // retried on the next PTY spawn/teardown.
      }
    }
  }
}

export const piTitlebarExtensionService = new PiTitlebarExtensionService()
