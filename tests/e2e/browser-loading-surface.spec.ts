import { expect, test } from './helpers/kolux-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { crashGuestRenderer } from './browser-guest-runtime-oracle'
import { observeBrowserLoadingSurface } from './browser-loading-surface-oracle'

test('browser host follows the theme before content and preserves the webpage canvas', async ({
  koluxPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(koluxPage)
  await ensureTerminalVisible(koluxPage)
  await waitForActiveWorktree(koluxPage)
  const observations = await observeBrowserLoadingSurface(
    koluxPage,
    (name) => testInfo.outputPath(name),
    async (id) => {
      await crashGuestRenderer(electronApp, id)
    }
  )
  expect(observations.filter((entry) => !entry.pass)).toEqual([])
})
