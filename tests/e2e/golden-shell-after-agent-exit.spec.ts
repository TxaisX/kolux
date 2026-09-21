import { expect, test } from './helpers/kolux-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForRestoredTerminalInputReady } from './helpers/restored-terminal-input-readiness'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

// Why: xterm renders the typed command itself, so `echo after-agent` would
// satisfy waitForTerminalOutput even if the shell never ran it. Splitting the
// marker keeps it out of the input, so a match proves real shell execution.
function buildSplitMarkerEcho(prefix: string, suffix: string): { command: string; marker: string } {
  const command =
    process.platform === 'win32'
      ? `Write-Output ('${prefix}' + '${suffix}')`
      : `echo "${prefix}""${suffix}"`
  return { command, marker: `${prefix}${suffix}` }
}

test('opens a clean live shell after an agent exits', async ({ koluxPage }) => {
  await waitForSessionReady(koluxPage)
  await waitForActiveWorktree(koluxPage)
  await ensureTerminalVisible(koluxPage)
  await configureGoldenStubAgent(koluxPage)
  await launchGoldenStubAgentFromNewTab(koluxPage)

  await koluxPage.keyboard.type('exit')
  await koluxPage.keyboard.press('Enter')
  await waitForTerminalOutput(koluxPage, GOLDEN_STUB_EXIT_MARKER, 15_000)

  const tabsBeforeShell = await koluxPage.locator('[data-testid="sortable-tab"]').count()
  await koluxPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await koluxPage
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click({ force: true })
  await expect(koluxPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
  const shellPtyId = await waitForActivePanePtyId(koluxPage)
  // Why: a bound ptyId only means the pane exists; the renderer transport can
  // still drop keystrokes until it connects, which would strand the markers.
  expect(await waitForRestoredTerminalInputReady(koluxPage, shellPtyId)).toBe(true)

  const afterAgent = buildSplitMarkerEcho('after-', 'agent')
  await focusActiveTerminalInput(koluxPage)
  await koluxPage.keyboard.type(afterAgent.command)
  await koluxPage.keyboard.press('Enter')
  await waitForTerminalOutput(koluxPage, afterAgent.marker, 15_000)

  const afterShiftEnter = buildSplitMarkerEcho('after-shift-', 'enter')
  await koluxPage.keyboard.press('Shift+Enter')
  await koluxPage.keyboard.type(afterShiftEnter.command)
  await koluxPage.keyboard.press('Enter')
  await waitForTerminalOutput(koluxPage, afterShiftEnter.marker, 15_000)
  await expect(koluxPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
})
