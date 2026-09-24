// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { getPlanReviewDraft, resetPlanReviewDraftsForTests } from './plan-review'

const { approvePlanMock, requestPlanChangesMock } = vi.hoisted(() => ({
  approvePlanMock: vi.fn<(settings: unknown, ptyId: string) => void>(),
  requestPlanChangesMock: vi.fn<
    (settings: unknown, ptyId: string, paneKey: string, text: string) => { cancel: () => void }
  >(() => ({ cancel: vi.fn() }))
}))

vi.mock('./plan-review-send', () => ({
  approvePlan: approvePlanMock,
  requestPlanChanges: requestPlanChangesMock
}))

import { PlanReviewSheet } from './PlanReviewSheet'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'
const PLAN_TEXT = 'Step one text\n\nStep two text'

function approvalEnvelope(planText: string): string {
  return JSON.stringify({ approval: { tool: 'ExitPlanMode', summary: 's', plan: planText } })
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  resetPlanReviewDraftsForTests()
  approvePlanMock.mockClear()
  requestPlanChangesMock.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useAppStore.setState({
    agentStatusByPaneKey: {
      [PANE_KEY]: { interactivePrompt: approvalEnvelope(PLAN_TEXT) }
    } as unknown as ReturnType<typeof useAppStore.getState>['agentStatusByPaneKey']
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function renderSheet(overrides: { open?: boolean; truncated?: boolean } = {}): {
  onOpenChange: ReturnType<typeof vi.fn>
  getPtyId: ReturnType<typeof vi.fn>
} {
  const onOpenChange = vi.fn()
  const getPtyId = vi.fn(() => 'pty-1')
  act(() => {
    root.render(
      <PlanReviewSheet
        open={overrides.open ?? true}
        onOpenChange={onOpenChange}
        paneKey={PANE_KEY}
        getPtyId={getPtyId}
        settings={undefined}
        plan={{ text: PLAN_TEXT, truncated: overrides.truncated ?? false }}
      />
    )
  })
  return { onOpenChange, getPtyId }
}

function findButtonByText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined
}

function click(el: Element | undefined): void {
  if (!el) {
    throw new Error('element not found')
  }
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

describe('PlanReviewSheet', () => {
  it('renders the plan split into sections', () => {
    renderSheet()
    expect(document.body.textContent).toContain('Step one text')
    expect(document.body.textContent).toContain('Step two text')
  })

  it('shows the truncated notice only when plan.truncated is true', () => {
    renderSheet({ truncated: true })
    expect(document.body.textContent).toContain('Plan shortened to fit')
  })

  it('disables Request changes with no comments and no note, enables Approve', () => {
    renderSheet()
    const requestButton = findButtonByText('Request changes')
    const approveButton = findButtonByText('Approve')
    expect(requestButton?.disabled).toBe(true)
    expect(approveButton?.disabled).toBe(false)
  })

  it('Approve sends the Allow byte and closes the sheet', () => {
    const { onOpenChange, getPtyId } = renderSheet()
    click(findButtonByText('Approve'))
    expect(getPtyId).toHaveBeenCalled()
    expect(approvePlanMock).toHaveBeenCalledWith(undefined, 'pty-1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('adding a comment enables Request changes and persists to the draft cache', () => {
    renderSheet()
    click(findButtonByText('Comment'))
    const textarea = document.querySelector('textarea')
    if (!textarea) {
      throw new Error('composer textarea not found')
    }
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set
      setter?.call(textarea, 'Please clarify step one.')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(findButtonByText('Add note'))

    expect(findButtonByText('Request changes (1)')?.disabled).toBe(false)
    expect(getPlanReviewDraft(PANE_KEY, PLAN_TEXT).comments).toHaveLength(1)
    expect(getPlanReviewDraft(PANE_KEY, PLAN_TEXT).comments[0]?.body).toBe(
      'Please clarify step one.'
    )
  })

  it('Request changes sends the formatted feedback and clears the draft', () => {
    renderSheet()
    click(findButtonByText('Comment'))
    const textarea = document.querySelector('textarea')
    if (!textarea) {
      throw new Error('composer textarea not found')
    }
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set
      setter?.call(textarea, 'Clarify step one.')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(findButtonByText('Add note'))

    click(findButtonByText('Request changes (1)'))

    expect(requestPlanChangesMock).toHaveBeenCalledTimes(1)
    const [, ptyId, paneKey, text] = requestPlanChangesMock.mock.calls[0]!
    expect(ptyId).toBe('pty-1')
    expect(paneKey).toBe(PANE_KEY)
    expect(text).toContain('Feedback on your plan. Revise it and present it again.')
    expect(text).toContain('Clarify step one.')
    expect(getPlanReviewDraft(PANE_KEY, PLAN_TEXT).comments).toHaveLength(0)
  })

  it('shows the no-longer-waiting notice and disables actions when the plan no longer matches', () => {
    useAppStore.setState({
      agentStatusByPaneKey: {
        [PANE_KEY]: { interactivePrompt: approvalEnvelope('a different plan') }
      } as unknown as ReturnType<typeof useAppStore.getState>['agentStatusByPaneKey']
    })
    renderSheet()
    expect(document.body.textContent).toContain('Claude is no longer waiting on this plan.')
    expect(findButtonByText('Approve')?.disabled).toBe(true)
  })
})
