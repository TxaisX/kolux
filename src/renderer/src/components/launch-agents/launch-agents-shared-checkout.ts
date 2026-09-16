import { useAppStore } from '@/store'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { preflightAgentTrust } from '@/lib/agent-trust-preflight'
import { buildQuickComposerStartup } from '@/hooks/composer-state/quick-startup-plan'
import { resolveLocalWindowsAgentStartupShell } from '../../../../shared/windows-terminal-shell'
import { tuiAgentToAgentKind } from '../../../../shared/agent-kind'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { regridToCurrentLeaves } from '../pane-layout/split-pane-for-new-session'
import { settingsWithSeatModel, type SharedCheckoutSeatRequest } from './launch-agents-requests'

/**
 * Shared-checkout launch: every seat runs in the project's own folder — no
 * worktree or branch is created — and each seat becomes its own pane in that
 * workspace's grid inside the main window. Starting a terminal is synchronous
 * (there is no background worktree create to wait on), so the seats are
 * created back to back, the tab-group tree is regridded once into a balanced
 * grid, and the workspace is revealed. The checkout is pre-trusted for every
 * agent in the wave first, so N panes do not all stop on the same trust prompt.
 */
export async function runSharedCheckoutLaunch(
  worktreeId: string,
  worktreePath: string,
  seats: readonly SharedCheckoutSeatRequest[],
  settings: GlobalSettings
): Promise<void> {
  // Why before any tab exists: a trust artifact must land before the first pty spawns.
  for (const agent of new Set(seats.map((seat) => seat.agent))) {
    await preflightAgentTrust({ agent, workspacePath: worktreePath })
  }
  const store = useAppStore.getState()
  const shell = resolveLocalWindowsAgentStartupShell({
    platform: CLIENT_PLATFORM,
    isRemote: false,
    terminalWindowsShell: settings.terminalWindowsShell
  })
  const rootGroupId = store.ensureWorktreeRootGroup(worktreeId)
  // Why: a fresh workspace's root group holds no tab yet — the first seat takes it
  // so the grid never shows an idle pane; every other seat gets its own new group.
  const rootGroupIsEmpty =
    (useAppStore.getState().groupsByWorktree[worktreeId] ?? []).find(
      (group) => group.id === rootGroupId
    )?.tabOrder.length === 0

  let seated = 0
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
    const groupId =
      seated === 0 && rootGroupIsEmpty
        ? rootGroupId
        : store.createEmptySplitGroup(worktreeId, rootGroupId, 'right', { activate: false })
    if (!groupId) {
      continue
    }
    const tab = store.createTab(worktreeId, groupId, undefined, {
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
    seated += 1
  }
  if (seated === 0) {
    return
  }
  regridToCurrentLeaves(useAppStore.getState(), worktreeId)
  activateAndRevealWorktree(worktreeId)
}
