import { test, expect } from './helpers/kolux-app'
import { getStoreState, waitForSessionReady } from './helpers/store'

test.describe('usage overview', () => {
  test.beforeEach(async ({ koluxPage }) => {
    await waitForSessionReady(koluxPage)
  })

  test('Stats & Usage opens on the combined overview with provider controls', async ({
    koluxPage
  }) => {
    await koluxPage.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsPage()
    })

    await expect
      .poll(async () => getStoreState<string>(koluxPage, 'activeView'), { timeout: 5_000 })
      .toBe('settings')
    await koluxPage.getByRole('button', { name: 'Stats & Usage' }).click()
    await expect(koluxPage.getByRole('heading', { name: 'Usage Analytics' })).toBeVisible()
    const providerDropdown = koluxPage.getByTestId('usage-provider-select')
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: Overview'
    )
    await expect(koluxPage.getByTestId('usage-overview-pane')).toBeVisible()
    await expect(koluxPage.getByRole('heading', { name: 'Usage Overview' })).toBeVisible()
    await expect(koluxPage.getByRole('heading', { name: 'Providers' })).toBeVisible()
    await expect(koluxPage.getByRole('button', { name: 'Enable Claude' })).toBeVisible()
    await expect(koluxPage.getByRole('button', { name: 'Enable Codex' })).toBeVisible()
    await expect(koluxPage.getByRole('button', { name: 'Enable OpenCode' })).toBeVisible()

    await providerDropdown.click()
    await koluxPage.getByRole('menuitem', { name: 'Codex', exact: true }).click()
    await expect(koluxPage.getByRole('heading', { name: 'Codex Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute('aria-label', 'Usage analytics provider: Codex')

    await providerDropdown.click()
    await koluxPage.getByRole('menuitem', { name: 'OpenCode', exact: true }).click()
    await expect(koluxPage.getByRole('heading', { name: 'OpenCode Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: OpenCode'
    )
  })
})
