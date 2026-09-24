import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'

const { sendRuntimePtyInputMock, sendNativeChatMessageMock } = vi.hoisted(() => ({
  sendRuntimePtyInputMock: vi.fn(),
  sendNativeChatMessageMock: vi.fn(() => ({ cancel: vi.fn(), settleAfterMs: 500 }))
}))

vi.mock('@/runtime/runtime-terminal-inspection', () => ({
  sendRuntimePtyInput: sendRuntimePtyInputMock
}))

vi.mock('../native-chat/native-chat-runtime-send', () => ({
  sendNativeChatMessage: sendNativeChatMessageMock
}))

import {
  approvePlan,
  requestPlanChanges,
  REQUEST_PLAN_CHANGES_STATUS_WAIT_MS
} from './plan-review-send'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

function setInteractivePrompt(value: string | undefined): void {
  useAppStore.setState({
    agentStatusByPaneKey: { [PANE_KEY]: { interactivePrompt: value } } as unknown as ReturnType<
      typeof useAppStore.getState
    >['agentStatusByPaneKey']
  })
}

beforeEach(() => {
  sendRuntimePtyInputMock.mockClear()
  sendNativeChatMessageMock.mockClear()
  useAppStore.setState({ agentStatusByPaneKey: {} })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('approvePlan', () => {
  it('writes the Allow byte (1) to the pty', () => {
    approvePlan(undefined, 'pty-1')
    expect(sendRuntimePtyInputMock).toHaveBeenCalledWith(undefined, 'pty-1', '1')
  })
})

describe('requestPlanChanges', () => {
  it('sends ESC first, then the formatted feedback once the pane leaves the plan prompt', () => {
    setInteractivePrompt(JSON.stringify({ approval: { tool: 'ExitPlanMode', plan: 'p' } }))
    requestPlanChanges(undefined, 'pty-1', PANE_KEY, 'feedback text')

    expect(sendRuntimePtyInputMock).toHaveBeenCalledTimes(1)
    expect(sendRuntimePtyInputMock).toHaveBeenCalledWith(undefined, 'pty-1', '\x1b')
    expect(sendNativeChatMessageMock).not.toHaveBeenCalled()

    setInteractivePrompt(undefined)
    expect(sendNativeChatMessageMock).toHaveBeenCalledWith(undefined, 'pty-1', 'feedback text')
  })

  it('falls back to sending after the wait ceiling when status never changes', () => {
    vi.useFakeTimers()
    setInteractivePrompt('still-here')
    requestPlanChanges(undefined, 'pty-1', PANE_KEY, 'feedback text')
    expect(sendNativeChatMessageMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REQUEST_PLAN_CHANGES_STATUS_WAIT_MS)
    expect(sendNativeChatMessageMock).toHaveBeenCalledWith(undefined, 'pty-1', 'feedback text')
  })

  it('sends immediately when the pane has already left the plan prompt', () => {
    setInteractivePrompt(undefined)
    requestPlanChanges(undefined, 'pty-1', PANE_KEY, 'feedback text')
    expect(sendNativeChatMessageMock).toHaveBeenCalledWith(undefined, 'pty-1', 'feedback text')
  })

  it('cancel stops the pending send and the underlying chat handle before it fires', () => {
    vi.useFakeTimers()
    setInteractivePrompt('still-here')
    const handle = requestPlanChanges(undefined, 'pty-1', PANE_KEY, 'feedback text')
    handle.cancel()
    vi.advanceTimersByTime(REQUEST_PLAN_CHANGES_STATUS_WAIT_MS)
    expect(sendNativeChatMessageMock).not.toHaveBeenCalled()
  })

  it('cancel after the send already fired cancels the chat send handle', () => {
    const innerCancel = vi.fn()
    sendNativeChatMessageMock.mockReturnValueOnce({ cancel: innerCancel, settleAfterMs: 500 })
    setInteractivePrompt(undefined)
    const handle = requestPlanChanges(undefined, 'pty-1', PANE_KEY, 'feedback text')
    handle.cancel()
    expect(innerCancel).toHaveBeenCalledTimes(1)
  })
})
