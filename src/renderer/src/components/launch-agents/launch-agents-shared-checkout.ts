import { useAppStore } from '@/store'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { buildQuickComposerStartup } from '@/hooks/composer-state/quick-startup-plan'
import { resolveLocalWindowsAgentStartupShell } from '../../../../shared/windows-terminal-shell'
import { tuiAgentToAgentKind } from '../../../../shared/agent-kind'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { settingsWithSeatModel, type SharedCheckoutSeatRequest } from './launch-agents-requests'
import { openTerminalWindowForSharedCheckoutSeat } from './launch-agents-window-handoff'

/**
 * Shared-checkout launch: every seat runs in the project's own folder — no
 * worktree or branch is created — and, like a `new-worktree` seat, gets its
 * own OS window rather than a pane in the main window. Starting the terminal
 * is synchronous (there is no background worktree create to wait on), so the
 * tab id is already known the moment it's created and the window opens
 * immediately, no polling required.
 */
export function runSharedCheckoutLaunch(
  worktreeId: string,
  seats: readonly SharedCheckoutSeatRequest[],
  settings: GlobalSettings
): void {
  const store = useAppStore.getState()
  const shell = resolveLocalWindowsAgentStartupShell({
    platform: CLIENT_PLATFORM,
    isRemote: false,
    terminalWindowsShell: settings.terminalWindowsShell
  })

  for (const seat of seats) {
    const { startupPlan } = buildQuickComposerStartup({
      agent: seat.agent,
      prompt: seat.prompt,
      draftPrompt: null,
      settings: settingsWithSeatModel(settings, seat.agent, seat.model),
      repoConnectionId: null,
      platform: CLIENT_PLATFORM,
      shell,
      isRemote: false,
      telemetrySource: 'sidebar'
    })
    if (!startupPlan) {
      continue
    }
    const tab = store.createTab(worktreeId, undefined, undefined, {
      launchAgent: seat.agent,
      activate: false
    })
    store.queueTabStartupCommand(tab.id, {
      command: startupPlan.launchCommand,
      ...(startupPlan.env ? { env: startupPlan.env } : {}),
      launchConfig: startupPlan.launchConfig,
      launchAgent: seat.agent,
      ...(startupPlan.sessionOptions ? { sessionOptions: startupPlan.sessionOptions } : {}),
      ...(startupPlan.startupCommandDelivery
        ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
        : {}),
      telemetry: {
        agent_kind: tuiAgentToAgentKind(seat.agent),
        launch_source: 'sidebar',
        request_kind: 'new'
      }
    })
    openTerminalWindowForSharedCheckoutSeat(worktreeId, tab.id)
  }
}
