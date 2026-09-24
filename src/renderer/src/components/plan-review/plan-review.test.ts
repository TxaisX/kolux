import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPlanReviewDraft,
  formatPlanReviewFeedback,
  getPlanReviewDraft,
  planReviewDraftKey,
  resetPlanReviewDraftsForTests,
  setPlanReviewDraft,
  splitPlanSections,
  type PlanReviewComment
} from './plan-review'

beforeEach(() => {
  resetPlanReviewDraftsForTests()
})

describe('splitPlanSections', () => {
  it('splits on blank lines and tracks 1-indexed line ranges', () => {
    const plan = 'Line 1\nLine 2\n\nLine 4\nLine 5'
    const sections = splitPlanSections(plan)
    expect(sections).toEqual([
      { key: 's0', startLine: 1, endLine: 2, text: 'Line 1\nLine 2' },
      { key: 's1', startLine: 4, endLine: 5, text: 'Line 4\nLine 5' }
    ])
  })

  it('ignores blank lines inside a fenced code block', () => {
    const plan = ['# Title', '', '```', 'code line 1', '', 'code line 2', '```', '', 'After'].join(
      '\n'
    )
    const sections = splitPlanSections(plan)
    expect(sections).toHaveLength(3)
    expect(sections[0]?.text).toBe('# Title')
    expect(sections[1]?.text).toContain('code line 1\n\ncode line 2')
    expect(sections[1]?.text.startsWith('```')).toBe(true)
    expect(sections[2]?.text).toBe('After')
  })

  it('collapses consecutive and leading/trailing blank lines without empty sections', () => {
    const plan = '\n\nOnly section\n\n\n'
    const sections = splitPlanSections(plan)
    expect(sections).toEqual([{ key: 's0', startLine: 3, endLine: 3, text: 'Only section' }])
  })

  it('returns no sections for an empty or all-blank plan', () => {
    expect(splitPlanSections('')).toEqual([])
    expect(splitPlanSections('\n\n\n')).toEqual([])
  })
})

describe('formatPlanReviewFeedback', () => {
  const plan = ['# Plan', '', 'Step 1: do the thing', 'Step 2: do another thing'].join('\n')

  it('starts with the fixed header', () => {
    const feedback = formatPlanReviewFeedback(plan, { comments: [], generalNote: '' })
    expect(feedback).toBe('Feedback on your plan. Revise it and present it again.')
  })

  it('includes each comment as line label + excerpt + body', () => {
    const comment: PlanReviewComment = {
      id: 'c1',
      sectionKey: 's1',
      startLine: 3,
      endLine: 3,
      body: 'Say which thing first.',
      createdAt: 0
    }
    const feedback = formatPlanReviewFeedback(plan, { comments: [comment], generalNote: '' })
    expect(feedback).toContain('Line 3')
    expect(feedback).toContain('Step 1: do the thing')
    expect(feedback).toContain('Say which thing first.')
  })

  it('appends the trimmed general note after comments', () => {
    const feedback = formatPlanReviewFeedback(plan, {
      comments: [],
      generalNote: '  Also consider tests.  '
    })
    expect(feedback.endsWith('Also consider tests.')).toBe(true)
  })
})

describe('plan review draft cache', () => {
  it('returns an empty draft when nothing was stored', () => {
    expect(getPlanReviewDraft('pane-a', 'plan text')).toEqual({ comments: [], generalNote: '' })
  })

  it('round-trips a stored draft under the pane+plan-text key', () => {
    const draft = { comments: [], generalNote: 'note' }
    setPlanReviewDraft('pane-a', 'plan text', draft)
    expect(getPlanReviewDraft('pane-a', 'plan text')).toEqual(draft)
    expect(getPlanReviewDraft('pane-a', 'different plan text')).toEqual({
      comments: [],
      generalNote: ''
    })
  })

  it('keys strictly on pane + plan text, joined by NUL', () => {
    expect(planReviewDraftKey('p', 't')).toBe('p\u0000t')
  })

  it('clears a stored draft', () => {
    setPlanReviewDraft('pane-a', 'plan text', { comments: [], generalNote: 'note' })
    clearPlanReviewDraft('pane-a', 'plan text')
    expect(getPlanReviewDraft('pane-a', 'plan text')).toEqual({ comments: [], generalNote: '' })
  })

  it('evicts the oldest entry once the cache exceeds 128 scopes', () => {
    for (let i = 0; i < 129; i += 1) {
      setPlanReviewDraft(`pane-${i}`, 'plan', { comments: [], generalNote: `n${i}` })
    }
    expect(getPlanReviewDraft('pane-0', 'plan')).toEqual({ comments: [], generalNote: '' })
    expect(getPlanReviewDraft('pane-128', 'plan')).toEqual({ comments: [], generalNote: 'n128' })
  })
})
