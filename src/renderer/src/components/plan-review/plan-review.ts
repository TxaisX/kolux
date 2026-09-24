// Pure plan-text splitting, feedback formatting, and the in-memory draft cache
// for the plan-review sheet. No IO here — PlanReviewSheet.tsx owns UI state,
// plan-review-send.ts owns the PTY writes.

import { getDiffCommentLineLabel } from '@/lib/diff-comment-compat'
import { getMarkdownReviewExcerpt } from '@/lib/markdown-review-notes'
import { setBoundedScopeCacheEntry } from '../native-chat/native-chat-composer-scope-cache'

export type PlanReviewSection = {
  key: string
  startLine: number
  endLine: number
  text: string
}

export type PlanReviewComment = {
  id: string
  sectionKey: string
  startLine: number
  endLine: number
  body: string
  createdAt: number
}

export type PlanReviewDraft = {
  comments: PlanReviewComment[]
  generalNote: string
}

/** New comment id + timestamp factory, kept out of the Sheet component body:
 *  oxlint's react-purity rule flags `Date.now`/`Math.random` calls anywhere in
 *  a component function, even inside a plain event-handler closure. */
export function createPlanReviewComment(
  section: Pick<PlanReviewSection, 'key' | 'startLine' | 'endLine'>,
  body: string
): PlanReviewComment {
  return {
    id: `${section.key}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sectionKey: section.key,
    startLine: section.startLine,
    endLine: section.endLine,
    body,
    createdAt: Date.now()
  }
}

const FENCE_MARKER_RE = /^\s*```/

/** Split a plan into sections at blank lines, ignoring blank lines inside
 *  fenced code blocks so a code sample never gets sliced apart. */
export function splitPlanSections(plan: string): PlanReviewSection[] {
  const lines = plan.split(/\r\n|\r|\n/)
  const sections: PlanReviewSection[] = []
  let bufferLines: string[] = []
  let bufferStart = 0
  let inFence = false
  let sectionIndex = 0

  const flush = (endLine: number): void => {
    if (bufferLines.length === 0) {
      return
    }
    sections.push({
      key: `s${sectionIndex}`,
      startLine: bufferStart,
      endLine,
      text: bufferLines.join('\n')
    })
    sectionIndex += 1
    bufferLines = []
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const isFenceMarker = FENCE_MARKER_RE.test(line)
    if (isFenceMarker) {
      inFence = !inFence
    }
    const isBlankOutsideFence = !inFence && !isFenceMarker && line.trim().length === 0
    if (isBlankOutsideFence) {
      flush(lineNumber - 1)
      return
    }
    if (bufferLines.length === 0) {
      bufferStart = lineNumber
    }
    bufferLines.push(line)
  })
  flush(lines.length)
  return sections
}

/** Message sent back to the agent on "Request changes": a fixed header, then
 *  each comment as its line label + excerpt + body, then the optional general
 *  note. Reuses the markdown-review-notes excerpt/label helpers so the format
 *  matches the existing diff-comment feedback the agent already sees. */
export function formatPlanReviewFeedback(plan: string, draft: PlanReviewDraft): string {
  const parts: string[] = ['Feedback on your plan. Revise it and present it again.']
  for (const comment of draft.comments) {
    const note = { lineNumber: comment.endLine, startLine: comment.startLine }
    const label = getDiffCommentLineLabel(note)
    const excerpt = getMarkdownReviewExcerpt(plan, note)
    parts.push([label, excerpt, comment.body].filter((part) => part.length > 0).join('\n'))
  }
  const generalNote = draft.generalNote.trim()
  if (generalNote) {
    parts.push(generalNote)
  }
  return parts.join('\n\n')
}

const EMPTY_DRAFT: PlanReviewDraft = { comments: [], generalNote: '' }

// Why a module-level cache (not a store slice): a plan-review draft is
// per-pane-per-plan-text scratch state that must survive the sheet closing
// and reopening, but never needs to be shared across panes or persisted to
// disk — an in-memory LRU matches the composer's own draft caches.
const planReviewDraftsByScopeKey = new Map<string, PlanReviewDraft>()

export function planReviewDraftKey(paneKey: string, planText: string): string {
  return `${paneKey}\u0000${planText}`
}

export function getPlanReviewDraft(paneKey: string, planText: string): PlanReviewDraft {
  return planReviewDraftsByScopeKey.get(planReviewDraftKey(paneKey, planText)) ?? EMPTY_DRAFT
}

export function setPlanReviewDraft(
  paneKey: string,
  planText: string,
  draft: PlanReviewDraft
): void {
  setBoundedScopeCacheEntry(
    planReviewDraftsByScopeKey,
    planReviewDraftKey(paneKey, planText),
    draft
  )
}

export function clearPlanReviewDraft(paneKey: string, planText: string): void {
  planReviewDraftsByScopeKey.delete(planReviewDraftKey(paneKey, planText))
}

export function resetPlanReviewDraftsForTests(): void {
  planReviewDraftsByScopeKey.clear()
}
