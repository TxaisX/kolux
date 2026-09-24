// PTY actions for the plan-review sheet: Approve writes '1' (same Allow byte
// NativeChatApprovalCard sends); Request changes writes ESC, waits for the
// pane to leave the ExitPlanMode prompt (or a fallback), then sends the
// formatted feedback as a chat message.

import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { useAppStore } from '@/store'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  sendNativeChatMessage,
  type NativeChatSendHandle
} from '../native-chat/native-chat-runtime-send'

const ESCAPE = '\x1b'

// Why not a fixed delay: ESC immediately followed by pasted text can be read
// as an Alt-modified escape sequence by the agent's TUI. Wait on the pane
// actually leaving the ExitPlanMode wait; this ceiling only covers a pane
// whose status never updates (e.g. a stale/disconnected host).
export const REQUEST_PLAN_CHANGES_STATUS_WAIT_MS = 3000

type RuntimeSettings = Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined

export function approvePlan(settings: RuntimeSettings, ptyId: string): void {
  sendRuntimePtyInput(settings, ptyId, '1')
}

export function requestPlanChanges(
  settings: RuntimeSettings,
  ptyId: string,
  paneKey: string,
  text: string
): { cancel: () => void } {
  sendRuntimePtyInput(settings, ptyId, ESCAPE)

  let cancelled = false
  let unsubscribe: (() => void) | null = null
  let fallbackTimer: ReturnType<typeof setTimeout> | null = null
  let sendHandle: NativeChatSendHandle | null = null

  const hasLeftPlanPrompt = (): boolean =>
    useAppStore.getState().agentStatusByPaneKey[paneKey]?.interactivePrompt === undefined

  const stopWaiting = (): void => {
    unsubscribe?.()
    unsubscribe = null
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer)
      fallbackTimer = null
    }
  }

  const proceed = (): void => {
    if (cancelled) {
      return
    }
    stopWaiting()
    sendHandle = sendNativeChatMessage(settings, ptyId, text)
  }

  if (hasLeftPlanPrompt()) {
    proceed()
  } else {
    unsubscribe = useAppStore.subscribe(() => {
      if (hasLeftPlanPrompt()) {
        proceed()
      }
    })
    fallbackTimer = setTimeout(proceed, REQUEST_PLAN_CHANGES_STATUS_WAIT_MS)
  }

  return {
    cancel: (): void => {
      cancelled = true
      stopWaiting()
      sendHandle?.cancel()
    }
  }
}
