import { expect, test } from './helpers/kolux-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { focusActiveTerminalInput, getTerminalContent } from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

test('launches an agent TUI with a live multiline composer', async ({ koluxPage }) => {
  await waitForSessionReady(koluxPage)
  await waitForActiveWorktree(koluxPage)
  await ensureTerminalVisible(koluxPage)
  await configureGoldenStubAgent(koluxPage)
  await launchGoldenStubAgentFromNewTab(koluxPage)

  const activeTab = koluxPage.locator('[data-testid="sortable-tab"][data-active="true"]')
  await expect(activeTab).toHaveAttribute('data-tab-title', /Codex|Golden Stub Agent/i)

  await focusActiveTerminalInput(koluxPage)
  await koluxPage.keyboard.type('hello from e2e')
  await koluxPage.keyboard.press('Shift+Enter')
  await koluxPage.keyboard.type('second line')

  await expect
    .poll(() => getTerminalContent(koluxPage), { timeout: 10_000 })
    .toContain('> hello from e2e\r\n  second line')
  expect(await getTerminalContent(koluxPage)).not.toContain('GOLDEN_STUB_AGENT_SUBMITTED')
})
