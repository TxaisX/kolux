import type { Page } from '@stablyai/playwright-test'
import { expect } from './helpers/kolux-app'
import { ensureTerminalVisible } from './helpers/store'
import { waitForActiveTerminalManager } from './helpers/terminal'
import { readTerminalPtyWriteEntries } from './helpers/terminal-pty-write-spy'
import type { RuntimeClient } from '../../src/cli/runtime-client'
import type { RuntimeTerminalSummary } from '../../src/shared/runtime-types'
import {
  canaryLedgerPath,
  liveTerminalIdentity,
  PROVIDER_SESSION_ID,
  readJsonLines,
  readSpawnLedger,
  readWorktreeTerminals,
  setupLedgerPath,
  terminalOutput,
  type TerminalIdentity
} from './live-background-terminal-mount-authority-fixtures'

async function readRendererBindings(page: Page, identities: TerminalIdentity[]) {
  return page.evaluate((targets) => {
    const state = window.__store?.getState()
    return targets.map(({ leafId, tabId }) => ({
      tabId,
      tabPtyId:
        Object.values(state?.tabsByWorktree ?? {})
          .flat()
          .find((tab) => tab.id === tabId)?.ptyId ?? null,
      ptyIds: state?.ptyIdsByTabId[tabId] ?? [],
      leafBindings: Object.entries(state?.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId ?? {}).sort(
        ([left], [right]) => left.localeCompare(right)
      ),
      leafId
    }))
  }, identities)
}

async function readPersistedBindings(
  page: Page,
  worktreeId: string,
  identities: TerminalIdentity[]
) {
  return page.evaluate(
    async ({ identities, worktreeId }) => {
      const session = await window.api.session.get()
      return identities.map(({ leafId, tabId }) => ({
        tabId,
        tabPtyId:
          session.tabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)?.ptyId ?? null,
        leafBindings: Object.entries(
          session.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId ?? {}
        ).sort(([left], [right]) => left.localeCompare(right)),
        leafId
      }))
    },
    { identities, worktreeId }
  )
}

function expectedBindings(identities: TerminalIdentity[], includeLiveIds: boolean) {
  return identities.map(({ leafId, ptyId, tabId }) => ({
    tabId,
    tabPtyId: ptyId,
    ...(includeLiveIds ? { ptyIds: [ptyId] } : {}),
    leafBindings: [[leafId, ptyId]],
    leafId
  }))
}

export async function assertTargetBindings(
  page: Page,
  worktreeId: string,
  identities: TerminalIdentity[]
): Promise<void> {
  await expect
    .poll(() => readRendererBindings(page, identities), { timeout: 15_000 })
    .toEqual(expectedBindings(identities, true))
  await expect
    .poll(() => readPersistedBindings(page, worktreeId, identities), { timeout: 15_000 })
    .toEqual(expectedBindings(identities, false))
}

export async function assertLiveInventory(
  client: RuntimeClient,
  worktreeId: string,
  originals: RuntimeTerminalSummary[]
): Promise<void> {
  await expect
    .poll(async () => (await readWorktreeTerminals(client, worktreeId)).map(liveTerminalIdentity), {
      timeout: 15_000
    })
    .toEqual(originals.map(liveTerminalIdentity))
}

export async function assertLaunchLedgersUnchanged(): Promise<void> {
  await expect
    .poll(
      () => ({
        agent: readSpawnLedger().length,
        setup: readJsonLines<{ pid: number }>(setupLedgerPath).length,
        canary: readJsonLines<{ pid: number }>(canaryLedgerPath).length
      }),
      { timeout: 10_000 }
    )
    .toEqual({ agent: 1, setup: 1, canary: 1 })
  const agentLaunches = readSpawnLedger()
  expect(agentLaunches.filter(({ args }) => args.includes('resume'))).toHaveLength(0)
  expect(agentLaunches.filter(({ args }) => args.includes(PROVIDER_SESSION_ID))).toHaveLength(0)
}

export async function assertNoInterruption(
  client: RuntimeClient,
  terminals: RuntimeTerminalSummary[]
): Promise<void> {
  const outputs = await Promise.all(
    terminals.map((terminal) => terminalOutput(client, terminal.handle))
  )
  expect(outputs.join('\n')).not.toContain('Conversation interrupted')
}

export async function faultProjectionAndActivate(
  page: Page,
  worktreeId: string,
  terminals: RuntimeTerminalSummary[],
  activeTabId: string
): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        ({ tabIds, worktreeId }) => {
          const state = window.__store?.getState()
          const tabs = state?.tabsByWorktree[worktreeId] ?? []
          return tabIds.every(
            (tabId) =>
              tabs.some((tab) => tab.id === tabId) &&
              Boolean(state?.terminalLayoutsByTabId[tabId]?.root) &&
              !window.__paneManagers?.has(tabId)
          )
        },
        { tabIds: terminals.map((terminal) => terminal.tabId), worktreeId }
      )
    )
    .toBe(true)

  await page.evaluate(
    ({ activeTabId, identities, worktreeId }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Renderer store unavailable')
      }
      store.setState((state) => {
        const tabsByWorktree = { ...state.tabsByWorktree }
        tabsByWorktree[worktreeId] = (tabsByWorktree[worktreeId] ?? []).map((tab) =>
          identities.some((identity) => identity.tabId === tab.id) ? { ...tab, ptyId: null } : tab
        )
        const ptyIdsByTabId = { ...state.ptyIdsByTabId }
        const terminalLayoutsByTabId = { ...state.terminalLayoutsByTabId }
        for (const identity of identities) {
          ptyIdsByTabId[identity.tabId] = []
          const layout = terminalLayoutsByTabId[identity.tabId]
          if (layout) {
            const ptyIdsByLeafId = { ...layout.ptyIdsByLeafId }
            delete ptyIdsByLeafId[identity.leafId]
            terminalLayoutsByTabId[identity.tabId] = {
              ...layout,
              ptyIdsByLeafId
            }
          }
        }
        return { tabsByWorktree, ptyIdsByTabId, terminalLayoutsByTabId }
      })
      const next = store.getState()
      next.setActiveRepo(
        next.repos.find((repo) => repo.id === worktreeId.split('::')[0])?.id ?? null
      )
      next.setActiveTabForWorktree(worktreeId, activeTabId)
      next.setActiveView('terminal')
      next.setActiveWorktree(worktreeId)
    },
    {
      activeTabId,
      identities: terminals.map(({ tabId, leafId }) => ({ tabId, leafId })),
      worktreeId
    }
  )
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
}

export async function activateTerminal(
  page: Page,
  worktreeId: string,
  tabId: string
): Promise<void> {
  await page.evaluate(
    ({ tabId, worktreeId }) => {
      const state = window.__store?.getState()
      state?.setActiveRepo(
        state.repos.find((repo) => repo.id === worktreeId.split('::')[0])?.id ?? null
      )
      state?.setActiveTabForWorktree(worktreeId, tabId)
      state?.setActiveView('terminal')
      state?.setActiveWorktree(worktreeId)
    },
    { tabId, worktreeId }
  )
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
  await page.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`).click({ force: true })
}

export async function enableTerminalAccessibility(page: Page, tabId: string): Promise<void> {
  await page.evaluate((id) => {
    const manager = window.__paneManagers?.get(id)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
    if (!pane) {
      throw new Error(`Terminal pane unavailable: ${id}`)
    }
    pane.terminal.options.screenReaderMode = true
    pane.terminal.refresh(0, pane.terminal.rows - 1)
  }, tabId)
  await expect(
    page.locator(`[data-terminal-tab-id=${JSON.stringify(tabId)}] .xterm-accessibility-tree`)
  ).toBeAttached({ timeout: 10_000 })
}

export function terminalAccessibility(page: Page, tabId: string) {
  return page.locator(`[data-terminal-tab-id=${JSON.stringify(tabId)}] .xterm-accessibility-tree`)
}

export async function terminalViewportText(page: Page, tabId: string): Promise<string> {
  return page.evaluate((id) => {
    const pane = window.__paneManagers?.get(id)?.getActivePane?.()
    if (!pane) {
      throw new Error(`Terminal pane unavailable: ${id}`)
    }
    const buffer = pane.terminal.buffer.active
    return Array.from(
      { length: pane.terminal.rows },
      (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? ''
    ).join('\n')
  }, tabId)
}

export async function typeIntoTerminal(page: Page, tabId: string, marker: string): Promise<void> {
  const terminal = page.locator(`[data-terminal-tab-id=${JSON.stringify(tabId)}] .xterm:visible`)
  await terminal.click({ force: true })
  await page.keyboard.type(marker, { delay: 20 })
  await page.keyboard.press('Enter')
}

export async function assertExactPtyReceivedMarker(
  electronApp: Parameters<typeof readTerminalPtyWriteEntries>[0],
  ptyId: string,
  marker: string
): Promise<void> {
  const command = `${marker}\r`
  await expect
    .poll(async () => {
      const entries = await readTerminalPtyWriteEntries(electronApp)
      return entries
        .filter((entry) => entry.id === ptyId)
        .map((entry) => entry.data)
        .join('')
    })
    .toContain(command)
  const unrelatedWrites = (await readTerminalPtyWriteEntries(electronApp))
    .filter((entry) => entry.id !== ptyId)
    .map((entry) => entry.data)
    .join('')
  expect(unrelatedWrites).not.toContain(command)
}
