// Why: repos written before the Nightshift->Kolux rename still have nightshift.yaml; read it as a
// fallback so they keep working, but always write/report kolux.yaml going forward.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const KOLUX_YAML_FILENAME = 'kolux.yaml'
export const LEGACY_NIGHTSHIFT_YAML_FILENAME = 'nightshift.yaml'

/** Resolve the on-disk path for a repo's project-config yaml, preferring kolux.yaml over the legacy name. */
export function resolveKoluxYamlPath(repoPath: string): string {
  const preferred = join(repoPath, KOLUX_YAML_FILENAME)
  if (existsSync(preferred)) {
    return preferred
  }
  const legacy = join(repoPath, LEGACY_NIGHTSHIFT_YAML_FILENAME)
  if (existsSync(legacy)) {
    return legacy
  }
  return preferred
}
