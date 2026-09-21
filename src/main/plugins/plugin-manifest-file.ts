import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { PLUGIN_MANIFEST_FILENAME } from '../../shared/plugins/plugin-manifest'

// Why: plugins installed before the Nightshift->Kolux rename still ship this manifest filename.
const LEGACY_PLUGIN_MANIFEST_FILENAME = 'nightshift-plugin.json'

/** A manifest is startup metadata, not an artifact payload. Bounding it keeps
 * discovery and install preview from allocating an attacker-sized JSON file. */
export const PLUGIN_MANIFEST_MAX_BYTES = 1024 * 1024

/** Resolve a plugin's manifest filename, accepting the pre-rename name when only that exists. */
export function resolvePluginManifestFilename(rootDir: string): string {
  if (existsSync(join(rootDir, PLUGIN_MANIFEST_FILENAME))) {
    return PLUGIN_MANIFEST_FILENAME
  }
  return existsSync(join(rootDir, LEGACY_PLUGIN_MANIFEST_FILENAME))
    ? LEGACY_PLUGIN_MANIFEST_FILENAME
    : PLUGIN_MANIFEST_FILENAME
}

export async function readPluginManifestText(rootDir: string): Promise<string> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  const manifestFilename = resolvePluginManifestFilename(rootDir)
  const stream = createReadStream(join(rootDir, manifestFilename))
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += bytes.byteLength
    if (totalBytes > PLUGIN_MANIFEST_MAX_BYTES) {
      throw new Error(`${manifestFilename} exceeds ${PLUGIN_MANIFEST_MAX_BYTES} bytes`)
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8')
}
