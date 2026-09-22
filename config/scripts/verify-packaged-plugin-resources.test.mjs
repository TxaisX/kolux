import { mkdir, mkdtemp, cp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  verifyPackagedPluginResources,
  hashPackagedPluginTree
} = require('./verify-packaged-plugin-resources.cjs')

// This fork ships no bundled plugins (resources/plugins/launch/bundled-plugins.json
// has an empty plugins array), so the mismatch-detection path below has no real
// fixture to exercise. Build a synthetic one-plugin launch tree instead.
async function makeFixturePluginResources(resourcesDir) {
  const launchRoot = join(resourcesDir, 'plugins', 'launch')
  const pluginRoot = join(launchRoot, 'txais.kolux-fixture-plugin')
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(
    join(pluginRoot, 'kolux-plugin.json'),
    JSON.stringify({ publisher: 'txais', id: 'kolux-fixture-plugin' })
  )
  await writeFile(join(pluginRoot, 'extra.json'), '{"fixture":true}\n')
  const contentHash = hashPackagedPluginTree(pluginRoot)
  await writeFile(
    join(launchRoot, 'bundled-plugins.json'),
    JSON.stringify({
      version: 1,
      plugins: [
        { pluginKey: 'txais.kolux-fixture-plugin', path: 'txais.kolux-fixture-plugin', contentHash }
      ]
    })
  )
  await writeFile(join(launchRoot, 'kolux-marketplace.json'), '{}\n')
  return { launchRoot, pluginRoot }
}

describe('verify packaged plugin resources', () => {
  it('accepts exact launch bytes copied into a packaged resources directory', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'kolux-packaged-plugins-'))
    try {
      await cp(
        join(process.cwd(), 'resources', 'plugins', 'launch'),
        join(resourcesDir, 'plugins', 'launch'),
        { recursive: true }
      )

      expect(() => verifyPackagedPluginResources(resourcesDir)).not.toThrow()
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  it('rejects mutated bytes in the packaged output', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'kolux-packaged-plugins-'))
    try {
      const { pluginRoot } = await makeFixturePluginResources(resourcesDir)
      await writeFile(join(pluginRoot, 'extra.json'), '{"mutated":true}\n')

      expect(() => verifyPackagedPluginResources(resourcesDir)).toThrow(
        'packaged bytes do not match txais.kolux-fixture-plugin'
      )
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })

  // The tree is hashed by raw bytes, so a CRLF checkout on Windows breaks the
  // pinned hash. These two guard the `.gitattributes` eol=lf pin that prevents it.
  it('pins the launch tree to LF so Windows checkouts hash identically', async () => {
    const attributes = await readFile(join(process.cwd(), '.gitattributes'), 'utf8')
    expect(attributes).toContain('/resources/plugins/** text eol=lf')
  })

  it('rejects a CRLF checkout of the launch tree', async () => {
    const resourcesDir = await mkdtemp(join(tmpdir(), 'kolux-packaged-plugins-'))
    try {
      const { launchRoot } = await makeFixturePluginResources(resourcesDir)
      for (const entry of await readdir(launchRoot, { recursive: true })) {
        const path = join(launchRoot, entry)
        if (!(await stat(path)).isFile()) {
          continue
        }
        await writeFile(path, (await readFile(path, 'utf8')).replace(/\r?\n/g, '\r\n'))
      }

      expect(() => verifyPackagedPluginResources(resourcesDir)).toThrow(
        /packaged bytes do not match txais\./
      )
    } finally {
      await rm(resourcesDir, { recursive: true, force: true })
    }
  })
})
