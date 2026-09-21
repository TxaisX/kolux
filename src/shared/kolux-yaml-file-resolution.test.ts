import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveKoluxYamlPath } from './kolux-yaml-file-resolution'

describe('resolveKoluxYamlPath', () => {
  let repoPath: string

  beforeEach(() => {
    repoPath = mkdtempSync(join(tmpdir(), 'kolux-yaml-resolution-'))
  })

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true })
  })

  it('prefers kolux.yaml when both files exist', () => {
    writeFileSync(join(repoPath, 'kolux.yaml'), 'scripts: {}\n')
    writeFileSync(join(repoPath, 'nightshift.yaml'), 'scripts: {}\n')
    expect(resolveKoluxYamlPath(repoPath)).toBe(join(repoPath, 'kolux.yaml'))
  })

  it('falls back to the legacy nightshift.yaml when kolux.yaml is absent', () => {
    writeFileSync(join(repoPath, 'nightshift.yaml'), 'scripts: {}\n')
    expect(resolveKoluxYamlPath(repoPath)).toBe(join(repoPath, 'nightshift.yaml'))
  })

  it('defaults to kolux.yaml when neither file exists', () => {
    expect(resolveKoluxYamlPath(repoPath)).toBe(join(repoPath, 'kolux.yaml'))
  })
})
