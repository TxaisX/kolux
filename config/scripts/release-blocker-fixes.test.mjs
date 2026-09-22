import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectDir = resolve(import.meta.dirname, '../..')

// Compares [major, minor, patch] tuples; positive when a > b.
function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i]
    }
  }
  return 0
}

describe('release blocker safeguards', () => {
  it('keeps the root package version on the current stable release line', () => {
    const packageJson = JSON.parse(readFileSync(resolve(projectDir, 'package.json'), 'utf8'))
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(packageJson.version)
    expect(match).not.toBeNull()
    const version = match.slice(1, 4).map(Number)

    // Why: Kolux stays on 0.x.y (AGENTS.md Versioning) instead of the old fork's 1.x
    // line, so the floor is the latest shipped v0.* tag, not a hardcoded 1.x number.
    const latestTag = execFileSync('git', ['tag', '--list', 'v0.*'], {
      cwd: projectDir,
      encoding: 'utf8'
    })
      .split('\n')
      .filter(Boolean)
      .map((tag) => tag.slice(1).split('.').map(Number))
      .reduce((max, tag) => (compareVersions(tag, max) > 0 ? tag : max))

    expect(compareVersions(version, latestTag)).toBeGreaterThanOrEqual(0)
  })
})
