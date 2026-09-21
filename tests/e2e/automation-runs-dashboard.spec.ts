/**
 * End-to-end coverage for the Automations runs surface.
 *
 * The test intentionally does not depend on seeded run history: a fresh E2E
 * profile may have no automations, but the Runs navigation and empty state must
 * still be usable.
 */

import { test, expect } from './helpers/kolux-app'
import { waitForSessionReady } from './helpers/store'

test('opens the runs dashboard and returns to automations', async ({ koluxPage }) => {
  await waitForSessionReady(koluxPage)

  await koluxPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    store.getState().openAutomationsPage()
  })

  const runsButton = koluxPage.getByRole('button', { name: 'Runs' })
  await expect(runsButton).toBeVisible()
  await runsButton.click()

  await expect(koluxPage.getByRole('navigation', { name: 'Automations breadcrumb' })).toBeVisible()
  await expect(koluxPage.getByText('Successful · 24h')).toBeVisible()
  await expect(koluxPage.getByText('Failed · 24h')).toBeVisible()
  await expect(koluxPage.getByText('Successful · 7d')).toBeVisible()
  await expect(koluxPage.getByText('Failed · 7d')).toBeVisible()
  await expect(koluxPage.getByRole('button', { name: 'Filters' })).toBeVisible()
  await expect(koluxPage.getByRole('button', { name: 'Refresh runs' })).toBeVisible()
  await expect(koluxPage.getByText('Automation', { exact: true })).toBeVisible()
  await expect(koluxPage.getByText('Triggered', { exact: true })).toBeVisible()
  await expect(koluxPage.getByText('Status', { exact: true })).toBeVisible()

  await koluxPage
    .getByRole('navigation', { name: 'Automations breadcrumb' })
    .getByRole('button', { name: 'Automations' })
    .click()
  await expect(koluxPage.getByRole('heading', { name: 'Automations' })).toBeVisible()
  await expect(runsButton).toBeVisible()
})
