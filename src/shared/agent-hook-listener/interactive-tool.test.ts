import { describe, expect, it } from 'vitest'
import { deriveInteractivePrompt } from './interactive-tool'
import { AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH } from '../agent-status-types'

describe('deriveInteractivePrompt — ExitPlanMode plan field', () => {
  it('includes the plan and no planTruncated flag when it fits', () => {
    const result = deriveInteractivePrompt(
      'ExitPlanMode',
      { plan: '# Plan\n\nDo the thing.' },
      'PermissionRequest'
    )
    expect(result).toBeDefined()
    const parsed = JSON.parse(result as string)
    expect(parsed.approval.tool).toBe('ExitPlanMode')
    expect(parsed.approval.plan).toBe('# Plan\n\nDo the thing.')
    expect(parsed.approval.planTruncated).toBeUndefined()
    expect((result as string).length).toBeLessThanOrEqual(
      AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH
    )
  })

  it('keeps newlines, quotes, and emoji valid JSON under the cap', () => {
    const plan = 'Line one\nLine "two" with quotes\nEmoji: 🎉🚀\nLine four'
    const result = deriveInteractivePrompt('ExitPlanMode', { plan }, 'PermissionRequest')
    const parsed = JSON.parse(result as string)
    expect(parsed.approval.plan).toBe(plan)
  })

  it('shrinks an oversized plan and marks planTruncated, keeping the envelope under the cap', () => {
    const hugePlan = 'x'.repeat(AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH * 2)
    const result = deriveInteractivePrompt('ExitPlanMode', { plan: hugePlan }, 'PermissionRequest')
    expect(result).toBeDefined()
    expect((result as string).length).toBeLessThanOrEqual(
      AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH
    )
    const parsed = JSON.parse(result as string)
    expect(parsed.approval.planTruncated).toBe(true)
    expect(parsed.approval.plan.length).toBeGreaterThan(0)
    expect(parsed.approval.plan.length).toBeLessThan(hugePlan.length)
  })

  it('does not split a surrogate pair when shrinking the plan', () => {
    // Why: an emoji sits right at a plausible truncation boundary.
    const filler = 'y'.repeat(AGENT_STATUS_INTERACTIVE_PROMPT_MAX_LENGTH * 2 - 2)
    const hugePlan = `${filler}🎉`
    const result = deriveInteractivePrompt('ExitPlanMode', { plan: hugePlan }, 'PermissionRequest')
    const parsed = JSON.parse(result as string)
    // A lone high surrogate would fail JSON.parse round-trip via stray \uD83C; here
    // we assert the plan string itself has no unpaired surrogate at its tail.
    const lastCode = (parsed.approval.plan as string).charCodeAt(
      (parsed.approval.plan as string).length - 1
    )
    expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false)
  })

  it('omits the plan field entirely when tool_input has no plan string', () => {
    const result = deriveInteractivePrompt('ExitPlanMode', {}, 'PermissionRequest')
    const parsed = JSON.parse(result as string)
    expect(parsed.approval.plan).toBeUndefined()
    expect(parsed.approval.summary).toBeDefined()
  })

  it('ignores a plan-shaped field on a different tool', () => {
    const result = deriveInteractivePrompt('Bash', { plan: 'not a plan' }, 'PermissionRequest')
    const parsed = JSON.parse(result as string)
    expect(parsed.approval.plan).toBeUndefined()
  })

  it('also builds the approval+plan card on a PreToolUse ExitPlanMode (no PermissionRequest)', () => {
    const result = deriveInteractivePrompt('ExitPlanMode', { plan: 'Do X' }, 'PreToolUse')
    expect(result).toBeDefined()
    const parsed = JSON.parse(result as string)
    expect(parsed.approval.tool).toBe('ExitPlanMode')
    expect(parsed.approval.plan).toBe('Do X')
  })

  it('does not build an approval card for a PreToolUse on a non-ExitPlanMode tool', () => {
    expect(deriveInteractivePrompt('Bash', { command: 'ls' }, 'PreToolUse')).toBeUndefined()
  })
})
