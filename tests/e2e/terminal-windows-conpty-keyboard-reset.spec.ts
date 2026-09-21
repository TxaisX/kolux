import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/kolux-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWriteEntries
} from './helpers/terminal-pty-write-spy'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })
test.skip(process.platform !== 'win32', 'A real Windows ConPTY is required')

async function getKittyKeyboardFlags(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const pane = tabId ? window.__paneManagers?.get(tabId)?.getActivePane?.() : null
    const terminal = pane?.terminal as
      | {
          core?: { coreService?: { kittyKeyboard?: { flags?: number } } }
          _core?: { coreService?: { kittyKeyboard?: { flags?: number } } }
        }
      | undefined
    return (
      terminal?.core?.coreService?.kittyKeyboard?.flags ??
      terminal?._core?.coreService?.kittyKeyboard?.flags ??
      null
    )
  })
}

test('resets standard keyboard bytes after a protocol-mode agent exits on ConPTY', async ({
  electronApp,
  koluxPage
}) => {
  await installTerminalPtyWriteSpy(electronApp)
  await waitForSessionReady(koluxPage)
  await waitForActiveWorktree(koluxPage)
  await ensureTerminalVisible(koluxPage)
  // Grok is the supported native ConPTY exception to Kitty protocol withholding.
  await configureGoldenStubAgent(koluxPage, {
    agent: 'grok',
    agentArgs: '--keyboard-protocol --grok'
  })
  await launchGoldenStubAgentFromNewTab(koluxPage, /^Grok(?:\s|$)/i)

  const ptyId = await waitForActivePanePtyId(koluxPage)
  await expect.poll(() => getKittyKeyboardFlags(koluxPage), { timeout: 10_000 }).toBe(1)

  await clearTerminalPtyWriteLog(electronApp)
  // Kitty flag 1 preserves plain Enter; modified Enter proves CSI-u input.
  await koluxPage.keyboard.press('Shift+Enter')
  await koluxPage.keyboard.type('exit')
  await koluxPage.keyboard.press('Enter')
  await waitForTerminalOutput(koluxPage, GOLDEN_STUB_EXIT_MARKER, 15_000)
  const protocolWrites = (await readTerminalPtyWriteEntries(electronApp))
    .filter((entry) => entry.id === ptyId)
    .map((entry) => entry.data)
    .join('')
  expect(protocolWrites).toContain('\x1b[13;2u')
  expect(protocolWrites).toContain('\r')
  await expect.poll(() => getKittyKeyboardFlags(koluxPage), { timeout: 10_000 }).toBe(0)

  await clearTerminalPtyWriteLog(electronApp)
  await focusActiveTerminalInput(koluxPage)
  await koluxPage.keyboard.type("Write-Output ('CONPTY_KEYBOARD_' + '")
  await koluxPage.evaluate((text) => window.api.ui.writeClipboardText(text), 'REET_')
  await koluxPage.keyboard.press('Control+V')
  await koluxPage.keyboard.press('ArrowLeft')
  await koluxPage.keyboard.press('ArrowLeft')
  await koluxPage.keyboard.press('ArrowLeft')
  await koluxPage.keyboard.type('S')
  await koluxPage.keyboard.press('ArrowRight')
  await koluxPage.keyboard.press('ArrowRight')
  await koluxPage.keyboard.press('ArrowRight')
  await koluxPage.keyboard.type('EXECUTEX')
  await koluxPage.keyboard.press('Backspace')
  await koluxPage.keyboard.type("D')")
  await koluxPage.keyboard.press('Enter')
  await waitForTerminalOutput(koluxPage, 'CONPTY_KEYBOARD_RESET_EXECUTED', 15_000)

  const shellWrites = (await readTerminalPtyWriteEntries(electronApp))
    .filter((entry) => entry.id === ptyId)
    .map((entry) => entry.data)
  const joinedShellWrites = shellWrites.join('')
  expect(joinedShellWrites).toContain('REET_')
  expect(shellWrites.filter((data) => data === '\x1b[D')).toHaveLength(3)
  expect(shellWrites.filter((data) => data === '\x1b[C')).toHaveLength(3)
  expect(shellWrites).toContain('\x7f')
  expect(shellWrites).toContain('\r')
  expect(joinedShellWrites).not.toMatch(new RegExp(`${String.fromCharCode(27)}\\[\\d+(?:;\\d+)*u`))
})
