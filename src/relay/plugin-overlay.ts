// Why: relay-side equivalent of Kolux's local agent integration installers.
// Pi/OMP get Kolux-managed extension files installed into the remote agent
// homes. Host paths from the renderer are meaningless on SSH targets, so the
// relay performs the remote filesystem work itself.
//
// Plugin source strings ship over the JSON-RPC channel at session-ready —
// they are NOT bundled with the relay binary because the relay is versioned
// independently from Kolux and the plugin source changes frequently as new
// agent events get added; bundling would make every such change a relay
// redeploy, and an old relay would silently serve stale plugin code.
//
// We deliberately do not reuse PiTitlebarExtensionService directly: it
// imports `electron` and rides on Kolux's userData path. The relay's
// electron-free constraint forces a thin parallel implementation rooted at
// the remote Pi/OMP homes for those agents.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { safeRemoveOverlay } from '../main/pty/overlay-mirror'
import type { PiAgentKind } from '../shared/pi-agent-kind'

type LegacyOverlayAgentKind = Exclude<PiAgentKind, 'prime-agent'>

const RELAY_HOOKS_DIR = '.kolux-relay'
// Why this constant survives OpenCode's removal: relays deployed before the
// ripout may have left a materialized overlay under this subdir. Only
// `sweepRetiredOpenCodeOverlays` below still references it, to clean that
// leftover up on the next relay start.
const RETIRED_OPENCODE_OVERLAY_SUBDIR = 'opencode-overlays'
const PI_OVERLAY_SUBDIR_BY_KIND: Record<LegacyOverlayAgentKind, string> = {
  pi: 'pi-overlays',
  omp: 'omp-overlays'
}
const PI_EXTENSION_FILE = 'kolux-agent-status.ts'
const PI_AGENT_SUBDIR = 'agent'
// Why: bare-shell OMP still needs KOLUX_OMP_STATUS_EXTENSION without mkdir ~/.omp.
// Mirror local userData/omp-managed-status-extension under the relay home root.
const OMP_MANAGED_STATUS_EXTENSION_DIR = 'omp-managed-status-extension'
const KOLUX_MANAGED_EXTENSION_MARKER = '@kolux-managed-pi-extension'

function withKoluxManagedPiExtensionMarker(source: string): string {
  return source.includes(KOLUX_MANAGED_EXTENSION_MARKER)
    ? source
    : `// ${KOLUX_MANAGED_EXTENSION_MARKER}\n${source}`
}
// Why: source-dir resolution is keyed off the launching agent (Pi or OMP).
// Both consume `PI_CODING_AGENT_DIR` but default to different `~/.<kind>/agent`
// paths on the remote disk. The renderer-chosen launch command flows in via
// the relay PtyEnvAugmenter ctx; never derived from disk presence (a
// cross-agent fallback shadows the other agent's user extensions when both
// are installed).
const PI_AGENT_HOME_DIR_NAME: Record<PiAgentKind, string> = {
  pi: '.pi',
  omp: '.omp',
  'prime-agent': '.prime'
}

function safeDirName(input: string): string {
  // Why: paneKey embeds tabId:paneId where tabId may itself contain
  // filesystem-unsafe characters in some Kolux builds. Hash to a fixed-width
  // hex name so any input produces a portable directory name.
  return createHash('sha256').update(input).digest('hex').slice(0, 32)
}

function isUsableId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && id.length <= 1024
}

export type PluginSources = {
  /** Source body of Pi's `kolux-agent-status.ts` to drop into <overlay>/extensions/. */
  piExtensionSource?: string
  /** Source body of OMP's `kolux-agent-status.ts` to drop into <overlay>/extensions/. */
  ompExtensionSource?: string
  /** Source body of Prime Agent's `kolux-agent-status.ts` to install in its real agent dir. */
  primeAgentExtensionSource?: string
}

/** Result of installing Pi-compatible status into a real agent home or OMP fallback path. */
export type MaterializePiResult = {
  /** Real agent dir when extensions were installed there. Absent for OMP status-only fallback. */
  sourceAgentDir?: string
  /** Absolute path to kolux-agent-status.ts (real home or relay-managed fallback). */
  statusExtensionPath?: string
}

/** One-shot cleanup for a relay deployed before OpenCode's removal: wipes any
 *  overlay tree a previous relay build left under `opencode-overlays`. Call
 *  once at relay start. Never follows the overlay's own symlinks/junctions
 *  (safeRemoveTree's contract) and is scoped under `$HOME/.kolux-relay` so it
 *  cannot reach anything outside it. */
export function sweepRetiredOpenCodeOverlays(opts?: { homeDir?: string }): void {
  const hooksRoot = join(opts?.homeDir ?? homedir(), RELAY_HOOKS_DIR)
  safeRemoveOverlay(join(hooksRoot, RETIRED_OPENCODE_OVERLAY_SUBDIR), hooksRoot)
}

export class PluginOverlayManager {
  private piExtensionSources: Record<PiAgentKind, string | null> = {
    pi: null,
    omp: null,
    'prime-agent': null
  }
  private homeDir: string
  private piRoots: Record<LegacyOverlayAgentKind, string>

  constructor(opts?: { homeDir?: string }) {
    const home = opts?.homeDir ?? homedir()
    this.homeDir = home
    this.piRoots = {
      pi: join(home, RELAY_HOOKS_DIR, PI_OVERLAY_SUBDIR_BY_KIND.pi),
      omp: join(home, RELAY_HOOKS_DIR, PI_OVERLAY_SUBDIR_BY_KIND.omp)
    }
  }

  /** Replace the cached source bodies. Called from relay.ts when Kolux sends
   *  `agent_hook.installPlugins`. The first install enables the augmenter
   *  output; subsequent installs (e.g. Kolux version upgrade in flight) refresh
   *  the cached source so future spawns see the new strings.
   *  Note: existing running agents keep whatever source they loaded at
   *  process start. Future PTYs pick up the refreshed source when the relay
   *  writes plugin/extension files before spawn. */
  setSources(sources: PluginSources): void {
    if (typeof sources.piExtensionSource === 'string') {
      this.piExtensionSources.pi = withKoluxManagedPiExtensionMarker(sources.piExtensionSource)
    }
    if (typeof sources.ompExtensionSource === 'string') {
      this.piExtensionSources.omp = withKoluxManagedPiExtensionMarker(sources.ompExtensionSource)
    }
    if (typeof sources.primeAgentExtensionSource === 'string') {
      this.piExtensionSources['prime-agent'] = withKoluxManagedPiExtensionMarker(
        sources.primeAgentExtensionSource
      )
    }
  }

  hasPiSource(kind?: PiAgentKind): boolean {
    if (kind) {
      return this.getPiExtensionSource(kind) !== null
    }
    return Object.values(this.piExtensionSources).some((source) => source !== null)
  }

  private getPiExtensionSource(kind: PiAgentKind): string | null {
    const source = this.piExtensionSources[kind]
    return source ?? (kind === 'omp' ? this.piExtensionSources.pi : null)
  }

  private getDefaultPiAgentDir(kind: PiAgentKind): string {
    return join(this.homeDir, PI_AGENT_HOME_DIR_NAME[kind], PI_AGENT_SUBDIR)
  }

  private canOverwritePiExtension(path: string): boolean {
    try {
      return readFileSync(path, 'utf8').includes(KOLUX_MANAGED_EXTENSION_MARKER)
    } catch {
      return true
    }
  }

  private writeOmpManagedStatusExtension(extensionSource: string): string | null {
    const fallbackDir = join(this.homeDir, RELAY_HOOKS_DIR, OMP_MANAGED_STATUS_EXTENSION_DIR)
    try {
      mkdirSync(fallbackDir, { recursive: true })
      const fallbackPath = join(fallbackDir, PI_EXTENSION_FILE)
      if (!this.canOverwritePiExtension(fallbackPath)) {
        return null
      }
      writeFileSync(fallbackPath, extensionSource)
      return fallbackPath
    } catch (err) {
      process.stderr.write(
        `[plugin-overlay] failed to write OMP managed status extension: ${err instanceof Error ? err.message : String(err)}\n`
      )
      return null
    }
  }

  /** Install the Pi/OMP status extension into the remote real agent dir.
   *  `kind` selects which Pi-compatible agent's default dir to use when
   *  `existingAgentDir` is not supplied.
   *
   *  When `materializeDefaultHome` is false (bare shells), missing default
   *  homes are left alone so unused agents do not recreate `~/.<agent>` (#10196).
   *  For OMP, a relay-owned status file is still written so bare shells can
   *  export KOLUX_OMP_STATUS_EXTENSION without KOLUX_OMP_SOURCE_AGENT_DIR. */
  materializePi(
    id: string,
    existingAgentDir?: string,
    kind: PiAgentKind = 'pi',
    options?: { materializeDefaultHome?: boolean }
  ): MaterializePiResult | null {
    const extensionSource = this.getPiExtensionSource(kind)
    if (!extensionSource || !isUsableId(id)) {
      return null
    }
    try {
      const sourceAgentDir = existingAgentDir ?? this.getDefaultPiAgentDir(kind)
      if (existingAgentDir && !existsSync(existingAgentDir)) {
        return null
      }
      const materializeDefaultHome = options?.materializeDefaultHome !== false
      if (!existingAgentDir && !existsSync(sourceAgentDir) && !materializeDefaultHome) {
        // Why: match local titlebar-extension-service bare-shell OMP policy —
        // status wrapper only, never mkdir ~/.omp for unused agents.
        if (kind === 'omp') {
          const statusExtensionPath = this.writeOmpManagedStatusExtension(extensionSource)
          return statusExtensionPath ? { statusExtensionPath } : null
        }
        return null
      }
      const extensionsDir = join(sourceAgentDir, 'extensions')
      mkdirSync(extensionsDir, { recursive: true })
      const extensionPath = join(extensionsDir, PI_EXTENSION_FILE)
      if (!this.canOverwritePiExtension(extensionPath)) {
        return null
      }
      writeFileSync(extensionPath, extensionSource)
      return {
        sourceAgentDir,
        statusExtensionPath: extensionPath
      }
    } catch (err) {
      process.stderr.write(
        `[plugin-overlay] failed to install ${kind} extension: ${err instanceof Error ? err.message : String(err)}\n`
      )
      return null
    }
  }

  /** Drop a paneKey's overlay dirs on PTY exit. Best-effort; cleanup over a
   *  recursive tree may fail on exotic filesystems but the worst-case
   *  outcome is unbounded growth on a long-lived relay, which the per-pane
   *  caches alone do not bound. */
  clearOverlay(id: string): void {
    if (!isUsableId(id)) {
      return
    }
    const safe = safeDirName(id)
    // Why: sweep every Pi-kind overlay root because PTY exit doesn't know
    // which kind materialized this id. Per-root scoping inside
    // safeRemoveOverlay keeps each call bounded to its own tree.
    for (const root of Object.values(this.piRoots)) {
      try {
        safeRemoveOverlay(join(root, safe), root)
      } catch (err) {
        // Why: log the failed cleanup so a permission/IO error is observable.
        // The leak is the failure mode the per-pane cache eviction exists to
        // prevent - silent swallows would let it accumulate invisibly on
        // long-running relays.
        process.stderr.write(
          `[plugin-overlay] failed to remove overlay dir ${join(root, safe)}: ${err instanceof Error ? err.message : String(err)}\n`
        )
      }
    }
  }
}
