/**
 * The build identity the deploy expects the host to answer with.
 *
 * It must be computed the same way `computeKoluxdBuildHash` computes it on the host —
 * sha256 of `koluxd.js`, first 16 hex characters — or the activation gate would reject every
 * healthy candidate. Keeping the two in one comment is deliberate: they are one contract
 * split across a network, and the version string cannot stand in for it, because
 * `KOLUX_VERSION` is whatever the launch command exported and two builds can carry one value.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const KOLUXD_BUILD_HASH_LENGTH = 16

export function computeLocalKoluxdBuildHash(localKoluxdDir: string): string {
  const entry = join(localKoluxdDir, 'koluxd.js')
  return createHash('sha256')
    .update(readFileSync(entry))
    .digest('hex')
    .slice(0, KOLUXD_BUILD_HASH_LENGTH)
}
