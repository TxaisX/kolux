// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NativeChatApprovalCard, type NativeChatApprovalCardProps } from './NativeChatApprovalCard'

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
})

function render(props: NativeChatApprovalCardProps): void {
  act(() => {
    root.render(<NativeChatApprovalCard {...props} />)
  })
}

function click(button: Element | null | undefined): void {
  if (!button) {
    throw new Error('button not found')
  }
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

const baseApproval = {
  title: 'Allow Bash?',
  options: [
    { label: 'Allow', send: '1' },
    { label: 'Deny', send: '\x1b' }
  ]
}

describe('NativeChatApprovalCard', () => {
  it('renders no "Review plan" button when approval.plan is absent', () => {
    render({ approval: baseApproval, onChoose: vi.fn() })
    const buttons = [...container.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons.some((text) => text?.includes('Review plan'))).toBe(false)
  })

  it('renders "Review plan" and calls onReviewPlan when approval.plan is set', () => {
    const onReviewPlan = vi.fn()
    render({
      approval: { ...baseApproval, plan: { text: 'Do X', truncated: false } },
      onChoose: vi.fn(),
      onReviewPlan
    })
    const reviewButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Review plan')
    )
    click(reviewButton)
    expect(onReviewPlan).toHaveBeenCalledTimes(1)
  })

  it('still calls onChoose for Allow/Deny when a plan is present', () => {
    const onChoose = vi.fn()
    render({
      approval: { ...baseApproval, plan: { text: 'Do X', truncated: false } },
      onChoose,
      onReviewPlan: vi.fn()
    })
    const allowButton = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Allow'
    )
    click(allowButton)
    expect(onChoose).toHaveBeenCalledWith('1')
  })
})
