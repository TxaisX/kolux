import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import type { TuiAgent } from '../../../shared/tui-agent'

/**
 * Resolve a pending-agent-choice pane once its picker fires.
 *
 * 'blank' clears the flag in place, so the pane mounts a terminal and spawns the
 * default shell like any other plain tab. An agent pick launches through the
 * same `launchAgentInNewTab` funnel every other agent launch uses, into the
 * placeholder's own pane, and only then closes the placeholder — so the picked
 * agent occupies the pane the user chose it for instead of drifting to the
 * active group.
 *
 * Why a module function rather than a hook callback: two surfaces render the
 * picker — the legacy pane list and the split-pane overlay — and they must
 * resolve a pick identically. One implementation keeps them from drifting.
 *
 * ponytail: an agent pick mints a fresh tab rather than reusing the
 * placeholder's id, which is fine because a pending pane never held scrollback.
 */
export function resolvePendingAgentChoice(
  tabId: string,
  worktreeId: string,
  pick: TuiAgent | 'blank'
): void {
  const store = useAppStore.getState()
  if (pick === 'blank') {
    store.resolveTabPendingAgentChoice(tabId)
    return
  }
  const groupId = (store.groupsByWorktree[worktreeId] ?? []).find((group) =>
    group.tabOrder.includes(tabId)
  )?.id
  const result = launchAgentInNewTab({
    agent: pick,
    worktreeId,
    ...(groupId ? { groupId } : {}),
    launchSource: 'shortcut'
  })
  if (!result) {
    toast.error(
      translate(
        'auto.lib.resolve-pending-agent-choice.launchFailed',
        'Could not build launch command for {{value0}}.',
        { value0: pick }
      )
    )
    return
  }
  useAppStore.getState().closeTab(tabId, { recordInteraction: false })
}
