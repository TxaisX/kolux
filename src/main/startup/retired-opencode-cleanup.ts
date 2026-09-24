/**
 * One-time, idempotent cleanup of on-disk leftovers from the retired OpenCode
 * integration: the hook-plugin overlay directories and the local usage-tracking
 * cache. Never touches the user's real `~/.config/opencode` — only Kolux-owned
 * paths directly under userData, walked with safeRemoveTree so a symlink or
 * Windows junction inside one of them is unlinked, never followed.
 *
 * Marker-guarded like MIGRATION_COMPLETE_MARKER in pre-kolux-userdata-migration.ts,
 * so a failed cleanup (permission error, locked file) is retried on the next launch
 * instead of being silently accepted as done.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeRemoveTree } from '../pty/overlay-mirror'

const CLEANUP_COMPLETE_MARKER = '.kolux-retired-opencode-cleanup-complete'

// Why these three: opencode-hooks and opencode-config-overlays are the hook-plugin
// overlay roots src/main/opencode/hook-service.ts used to build; kolux-opencode-usage.json
// is the local usage-tracking cache src/main/opencode-usage/store.ts used to write. All
// three are now dead weight since OpenCode support was removed entirely.
const RETIRED_OPENCODE_USER_DATA_ENTRIES = [
  'opencode-hooks',
  'opencode-config-overlays',
  'kolux-opencode-usage.json'
] as const

export function cleanupRetiredOpenCodeUserData(canonicalUserDataPath: string): void {
  const markerPath = join(canonicalUserDataPath, CLEANUP_COMPLETE_MARKER)
  if (existsSync(markerPath)) {
    return
  }
  for (const entry of RETIRED_OPENCODE_USER_DATA_ENTRIES) {
    safeRemoveTree(join(canonicalUserDataPath, entry))
  }
  try {
    mkdirSync(canonicalUserDataPath, { recursive: true })
    writeFileSync(markerPath, `${JSON.stringify({ cleanedUpAt: Date.now() })}\n`)
  } catch (error) {
    console.warn('[retired-opencode-cleanup] Failed to write completion marker:', error)
  }
}
