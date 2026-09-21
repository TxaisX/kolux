import { expect, test } from './helpers/kolux-app'
import { openFileExplorer } from './helpers/file-explorer'
import { pressShortcut } from './helpers/shortcuts'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer-opened Markdown accepts the find shortcut without a document click', async ({
  koluxPage
}) => {
  await waitForSessionReady(koluxPage)
  await waitForActiveWorktree(koluxPage)
  await openFileExplorer(koluxPage)

  const readmeRow = koluxPage.locator('[data-file-explorer-row]').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.focus()
  await readmeRow.click()

  await expect(koluxPage.locator('.rich-markdown-editor')).toBeVisible({ timeout: 25_000 })
  await pressShortcut(koluxPage, 'f')

  await expect(
    koluxPage.getByRole('textbox', { name: 'Find in rich markdown editor' })
  ).toBeVisible()
})
