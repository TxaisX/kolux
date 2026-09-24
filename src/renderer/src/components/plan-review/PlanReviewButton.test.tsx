// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'

const { approvePlanMock, requestPlanChangesMock } = vi.hoisted(() => ({
  approvePlanMock: vi.fn(),
  requestPlanChangesMock: vi.fn(() => ({ cancel: vi.fn() }))
}))

vi.mock('./plan-review-send', () => ({
  approvePlan: approvePlanMock,
  requestPlanChanges: requestPlanChangesMock
}))

import { PlanReviewButton } from './PlanReviewButton'

const PANE_KEY = 'tab-1:11111111-1111-4111-8111-111111111111'

function approvalEnvelope(plan?: string): string {
  return JSON.stringify({
    approval: { tool: plan ? 'ExitPlanMode' : 'Bash', summary: 's', plan }
  })
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useAppStore.setState({ agentStatusByPaneKey: {} })
})

function renderButton(): void {
  act(() => {
    root.render(
      <TooltipProvider>
        <PlanReviewButton tabId="tab-1" paneKey={PANE_KEY} getPtyId={() => 'pty-1'} />
      </TooltipProvider>
    )
  })
}

describe('PlanReviewButton', () => {
  it('renders nothing when the pane has no interactivePrompt', () => {
    renderButton()
    expect(container.querySelector('button')).toBeNull()
  })

  it('renders nothing for a non-plan approval (e.g. Bash)', () => {
    useAppStore.setState({
      agentStatusByPaneKey: {
        [PANE_KEY]: { interactivePrompt: approvalEnvelope() }
      } as unknown as ReturnType<typeof useAppStore.getState>['agentStatusByPaneKey']
    })
    renderButton()
    expect(container.querySelector('button')).toBeNull()
  })

  it('renders the button and opens the sheet when approval.plan is set', () => {
    useAppStore.setState({
      agentStatusByPaneKey: {
        [PANE_KEY]: { interactivePrompt: approvalEnvelope('Do the thing') }
      } as unknown as ReturnType<typeof useAppStore.getState>['agentStatusByPaneKey']
    })
    renderButton()
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(document.body.textContent).toContain('Do the thing')
  })
})
