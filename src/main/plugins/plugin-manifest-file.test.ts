import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPluginManifestText, resolvePluginManifestFilename } from './plugin-manifest-file'
import { PLUGIN_MANIFEST_FILENAME } from '../../shared/plugins/plugin-manifest'

describe('resolvePluginManifestFilename', () => {
  let rootDir: string

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'plugin-manifest-'))
  })

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true })
  })

  it('prefers kolux-plugin.json when both manifests exist', () => {
    writeFileSync(join(rootDir, PLUGIN_MANIFEST_FILENAME), '{}')
    writeFileSync(join(rootDir, 'nightshift-plugin.json'), '{}')
    expect(resolvePluginManifestFilename(rootDir)).toBe(PLUGIN_MANIFEST_FILENAME)
  })

  it('falls back to the legacy nightshift-plugin.json filename', () => {
    writeFileSync(join(rootDir, 'nightshift-plugin.json'), '{"id":"legacy"}')
    expect(resolvePluginManifestFilename(rootDir)).toBe('nightshift-plugin.json')
  })

  it('defaults to kolux-plugin.json when neither manifest exists', () => {
    expect(resolvePluginManifestFilename(rootDir)).toBe(PLUGIN_MANIFEST_FILENAME)
  })

  it('reads manifest text through the legacy filename fallback', async () => {
    writeFileSync(join(rootDir, 'nightshift-plugin.json'), '{"id":"legacy"}')
    await expect(readPluginManifestText(rootDir)).resolves.toBe('{"id":"legacy"}')
  })
})
