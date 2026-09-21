// Throwaway interactive preview (untracked): opens Settings → Browser scrolled
// to the new Remote browsing section and holds the app open for review.
// Run: KOLUX_SETTINGS_PREVIEW=1 pnpm exec playwright test --config tests/playwright.config.ts \
//   --project electron-headless --workers=1 tests/e2e/browser-settings-preview.spec.ts
import { expect, test } from './helpers/kolux-app'

test.skip(
  process.env.KOLUX_SETTINGS_PREVIEW !== '1',
  'Preview only; run with KOLUX_SETTINGS_PREVIEW=1'
)

const HOLD_MINUTES = 20

test('shows the remote browsing settings section and holds for review', async ({
  electronApp,
  koluxPage
}) => {
  test.setTimeout((HOLD_MINUTES + 10) * 60_000)

  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window?.setSize(1440, 900)
    window?.center()
    window?.show()
    window?.focus()
  })

  // Seed one opted-out SSH host so the "Route again" list renders too.
  await koluxPage.evaluate(() => {
    const state = window.__store?.getState()
    state?.updateSettings({ browserSshWorkspaceRoutingDisabledTargetIds: ['preview-target'] })
    window.__store?.setState({
      sshTargetLabels: new Map([['preview-target', 'openclaw']])
    } as never)
    state?.openSettingsTarget({
      pane: 'browser',
      repoId: null,
      sectionId: 'browser-ssh-workspace-routing'
    })
    state?.openSettingsPage()
  })

  await expect(koluxPage.getByText('Remote browsing', { exact: true })).toBeVisible({
    timeout: 30_000
  })

  console.log(`\n=== SETTINGS PREVIEW READY — window stays up ${HOLD_MINUTES} minutes ===\n`)
  await koluxPage.waitForTimeout(HOLD_MINUTES * 60_000)
})
