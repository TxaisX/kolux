import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isOfficialOrganizationGitSource,
  isOfficialPluginIdentity,
  pluginMarketplaceSchema
} from '../../shared/plugins/plugin-marketplace'
import {
  BUNDLED_PLUGIN_INDEX_FILENAME,
  bootstrapBundledPlugins,
  resolveBundledPluginRoot
} from './plugin-bundled-bootstrap'
import { inspectPluginInstallTree } from './plugin-install-staging'

const launchRoot = join(process.cwd(), 'resources', 'plugins', 'launch')
const temporaryRoots: string[] = []

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

// Why: the fork ships no launch packs (503b56eda removed upstream's); these pin that whatever
// ships stays consistent across marketplace, directories, release index, and bootstrap.
describe('launch plugin content', () => {
  async function readShippedContent(): Promise<{ listedIds: string[]; indexedKeys: string[] }> {
    const marketplace = pluginMarketplaceSchema.parse(
      await readJson(join(launchRoot, 'kolux-marketplace.json'))
    )
    // Why: bootstrapBundledPlugins schema-validates this index; the tests below assert it reports no errors.
    const index = (await readJson(join(launchRoot, BUNDLED_PLUGIN_INDEX_FILENAME))) as {
      plugins: { pluginKey: string }[]
    }
    return {
      listedIds: marketplace.plugins.map((plugin) => plugin.id).sort(),
      indexedKeys: index.plugins.map((plugin) => plugin.pluginKey).sort()
    }
  }

  it('lists and validates the launch plugin packs', async () => {
    const marketplace = pluginMarketplaceSchema.parse(
      await readJson(join(launchRoot, 'kolux-marketplace.json'))
    )
    const { listedIds, indexedKeys } = await readShippedContent()

    const localPluginDirectories = (await readdir(launchRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    expect(listedIds).toEqual(localPluginDirectories)
    expect(indexedKeys.every((key) => listedIds.includes(key))).toBe(true)

    for (const listing of marketplace.plugins) {
      expect(isOfficialPluginIdentity(listing.id), `${listing.id} must be official`).toBe(true)
      expect(isOfficialOrganizationGitSource(listing.source.url)).toBe(true)
      const inspection = await inspectPluginInstallTree({
        rootDir: join(launchRoot, listing.id),
        hostVersion: '1.4.0',
        expectedPluginKey: listing.id
      })
      expect(inspection, `${listing.id} must pass the production install inspection`).toMatchObject(
        {
          ok: true
        }
      )
    }
  })

  it('publishes every bundled pack only when its release hash matches exact bytes', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'kolux-launch-content-'))
    temporaryRoots.push(userDataPath)
    const { indexedKeys } = await readShippedContent()

    const result = await bootstrapBundledPlugins({
      root: launchRoot,
      userDataPath,
      hostVersion: '1.4.0'
    })

    expect(result.errors).toEqual([])
    expect([...result.installed].sort()).toEqual(indexedKeys)
    expect(result.installed.every(isOfficialPluginIdentity)).toBe(true)
  })

  it('boots release-indexed content from the packaged resources layout', async () => {
    const resourcesPath = await mkdtemp(join(tmpdir(), 'kolux-packaged-resources-'))
    const userDataPath = await mkdtemp(join(tmpdir(), 'kolux-packaged-user-data-'))
    temporaryRoots.push(resourcesPath, userDataPath)
    const packagedRoot = join(resourcesPath, 'plugins', 'launch')
    await cp(launchRoot, packagedRoot, { recursive: true })
    const { indexedKeys } = await readShippedContent()

    const result = await bootstrapBundledPlugins({
      root: resolveBundledPluginRoot({
        isPackaged: true,
        resourcesPath,
        appPath: join(resourcesPath, 'app.asar')
      }),
      userDataPath,
      hostVersion: '1.4.0'
    })

    expect(result.errors).toEqual([])
    expect([...result.installed].sort()).toEqual(indexedKeys)
  })
})
