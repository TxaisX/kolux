/**
 * What a packaged `koluxd` directory must contain, declared once — the same single-source
 * treatment `relay-artifacts.ts` gives the relay, for the same reason: the build, the
 * content hash and the remote install probe must not keep three lists that drift.
 *
 * Order is load-bearing: the hash concatenates these files in sequence.
 *
 * Keep this file erasable-only TypeScript — build-koluxd.mjs imports it directly under
 * Node's type stripping, which rejects enums, namespaces and parameter properties.
 */

export const KOLUXD_VERSION = '0.1.0'

export type KoluxdArtifact = {
  filename: string
  /**
   * Absence is a degradation, not a torn install, so the remote probe must not require it.
   * The agent-browser binary is the only one: `resolveKoluxdBrowserProvider` already answers
   * "no headless browser" when it is missing, and it is named per platform-arch anyway.
   */
  optional?: boolean
}

export const KOLUXD_ARTIFACTS: readonly KoluxdArtifact[] = [
  { filename: 'koluxd.js' },
  // Forked so a native @parcel/watcher fault kills the child, not the server.
  { filename: 'parcel-watcher-process-entry.js' },
  // Forked so PTYs outlive the runtime process; its absence makes every restart destructive.
  { filename: 'daemon-entry.js' }
]

/** Written after the artifacts, so it is never an input to its own hash. */
export const KOLUXD_VERSION_FILENAME = '.version'

/** Written last by the installer; its absence means a torn install. */
export const KOLUXD_INSTALL_COMPLETE_FILENAME = '.install-complete'

export function koluxdArtifactFilenames(): string[] {
  return KOLUXD_ARTIFACTS.filter((artifact) => !artifact.optional).map(
    (artifact) => artifact.filename
  )
}
