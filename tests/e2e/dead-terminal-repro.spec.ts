/**
 * Stress test for dead-terminal reproduction (setup-split flow).
 *
 * Why @headful: the dead-terminal bug is a WebGL canvas staleness issue — after
 * wrapInSplit() reparents the existing pane's container, the WebGL canvas can
 * fail to repaint. In headless mode WebGL is NEVER active, so the DOM fallback
 * renderer is used and the bug cannot manifest. Running headful ensures real
 * WebGL contexts matching production.
 *
 * See helpers/dead-terminal.ts for the shared worktree-creation helper that
 * replicates the exact activateAndRevealWorktree + ensureWorktreeHasInitialTerminal
 * production flow.
 */

import { test, expect } from './helpers/kolux-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { waitForActiveTerminalManager, waitForPaneCount } from './helpers/terminal'
import {
  createAndActivateWorktreeWithSetup,
  removeWorktreeViaStore,
  waitForAllPanesToHaveContent,
  checkWebglState
} from './helpers/dead-terminal'

const STRESS_ITERATIONS = 5

test.describe('Dead Terminal Reproduction @headful', () => {
  const createdWorktreeIds: string[] = []

  test.beforeEach(async ({ koluxPage }) => {
    await waitForSessionReady(koluxPage)
    await waitForActiveWorktree(koluxPage)
    await ensureTerminalVisible(koluxPage)

    await koluxPage.evaluate(async () => {
      const state = window.__store?.getState()
      if (!state) {
        return
      }
      state.updateSettings({ setupScriptLaunchMode: 'split-vertical' })
    })
  })

  test.afterEach(async ({ koluxPage }) => {
    for (const id of createdWorktreeIds) {
      await removeWorktreeViaStore(koluxPage, id)
    }
    createdWorktreeIds.length = 0
  })

  test('@headful setup-split flow does not produce dead terminals', async ({ koluxPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(koluxPage)
    await waitForActiveTerminalManager(koluxPage, 30_000)
    await checkWebglState(koluxPage, 'home-initial')

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const direction = i % 2 === 0 ? 'vertical' : 'horizontal'
      const newId = await createAndActivateWorktreeWithSetup(koluxPage, `setup-${i}`, direction)
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(koluxPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(koluxPage)
      await waitForActiveTerminalManager(koluxPage, 30_000)
      await waitForPaneCount(koluxPage, 2, 15_000)
      await checkWebglState(koluxPage, `setup-${i}`)
      await waitForAllPanesToHaveContent(koluxPage, `setup-${i} both panes`)

      await switchToWorktree(koluxPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(koluxPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(koluxPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful setup-split then switch-back does not leave panes dead', async ({ koluxPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(koluxPage)
    await waitForActiveTerminalManager(koluxPage, 30_000)

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const newId = await createAndActivateWorktreeWithSetup(
        koluxPage,
        `switchback-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(koluxPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(koluxPage)
      await waitForActiveTerminalManager(koluxPage, 30_000)
      await waitForPaneCount(koluxPage, 2, 15_000)
      await waitForAllPanesToHaveContent(koluxPage, `switchback-${i} initial`)

      await switchToWorktree(koluxPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(koluxPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await ensureTerminalVisible(koluxPage)
      await waitForActiveTerminalManager(koluxPage, 15_000)

      await switchToWorktree(koluxPage, newId)
      await expect.poll(async () => getActiveWorktreeId(koluxPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(koluxPage)
      await waitForActiveTerminalManager(koluxPage, 15_000)
      await waitForAllPanesToHaveContent(koluxPage, `switchback-${i} after return`)

      await switchToWorktree(koluxPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(koluxPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(koluxPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful rapid switching between many setup-split worktrees', async ({ koluxPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(koluxPage)
    await waitForActiveTerminalManager(koluxPage, 30_000)

    const worktreeIds = [homeWorktreeId]
    for (let i = 0; i < 4; i++) {
      const newId = await createAndActivateWorktreeWithSetup(koluxPage, `multi-${i}`, 'vertical')
      createdWorktreeIds.push(newId)
      worktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(koluxPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(koluxPage)
      await waitForActiveTerminalManager(koluxPage, 30_000)
      await waitForPaneCount(koluxPage, 2, 15_000)
      await waitForAllPanesToHaveContent(koluxPage, `multi-create-${i}`)
    }

    for (let round = 0; round < 3; round++) {
      for (const wId of worktreeIds) {
        await switchToWorktree(koluxPage, wId)
        await expect.poll(async () => getActiveWorktreeId(koluxPage), { timeout: 10_000 }).toBe(wId)
        await ensureTerminalVisible(koluxPage)
        await waitForActiveTerminalManager(koluxPage, 15_000)
        await waitForAllPanesToHaveContent(koluxPage, `multi-r${round}-${wId.slice(0, 8)}`)
      }
    }
  })
})
