import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { MarkdownPreviewAnnotationComposer } from '@/components/editor/MarkdownPreviewAnnotationComposer'
import { translate } from '@/i18n/i18n'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { parseApprovalFromStatus } from '../native-chat/native-chat-interactive-prompt'
import {
  clearPlanReviewDraft,
  createPlanReviewComment,
  formatPlanReviewFeedback,
  getPlanReviewDraft,
  setPlanReviewDraft,
  splitPlanSections,
  type PlanReviewDraft
} from './plan-review'
import { approvePlan, requestPlanChanges } from './plan-review-send'

export type PlanReviewSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  paneKey: string
  getPtyId: () => string | null
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  plan: { text: string; truncated: boolean }
}

/** Right-edge sheet for commenting on a plan's sections and sending Approve /
 *  Request changes back to the agent. One instance is mounted per trigger
 *  (header button, approval card); both read/write the same paneKey+planText
 *  draft cache in plan-review.ts, so switching triggers keeps comments. */
export function PlanReviewSheet({
  open,
  onOpenChange,
  paneKey,
  getPtyId,
  settings,
  plan
}: PlanReviewSheetProps): React.JSX.Element {
  const sections = useMemo(() => splitPlanSections(plan.text), [plan.text])
  const [draft, setDraftState] = useState<PlanReviewDraft>(() =>
    getPlanReviewDraft(paneKey, plan.text)
  )
  const [commentingSectionKey, setCommentingSectionKey] = useState<string | null>(null)
  const [generalNoteOpen, setGeneralNoteOpen] = useState(false)

  // A new plan (ExitPlanMode called again) is a new draft key — reload rather
  // than carry the previous plan's comments over.
  useEffect(() => {
    setDraftState(getPlanReviewDraft(paneKey, plan.text))
    setCommentingSectionKey(null)
  }, [paneKey, plan.text])

  const liveInteractivePrompt = useAppStore(
    (s) => s.agentStatusByPaneKey[paneKey]?.interactivePrompt ?? null
  )
  const stillWaitingOnThisPlan = useMemo(
    () => parseApprovalFromStatus(liveInteractivePrompt)?.plan?.text === plan.text,
    [liveInteractivePrompt, plan.text]
  )

  const persist = (next: PlanReviewDraft): void => {
    setDraftState(next)
    setPlanReviewDraft(paneKey, plan.text, next)
  }

  const addComment = (
    section: { key: string; startLine: number; endLine: number },
    body: string
  ): void => {
    persist({ ...draft, comments: [...draft.comments, createPlanReviewComment(section, body)] })
  }

  const removeComment = (id: string): void => {
    persist({ ...draft, comments: draft.comments.filter((c) => c.id !== id) })
  }

  const canRequestChanges = draft.comments.length > 0 || draft.generalNote.trim().length > 0

  const handleApprove = (): void => {
    const ptyId = getPtyId()
    if (ptyId) {
      approvePlan(settings, ptyId)
    }
    clearPlanReviewDraft(paneKey, plan.text)
    onOpenChange(false)
  }

  const handleRequestChanges = (): void => {
    const ptyId = getPtyId()
    if (!ptyId) {
      return
    }
    requestPlanChanges(settings, ptyId, paneKey, formatPlanReviewFeedback(plan.text, draft))
    clearPlanReviewDraft(paneKey, plan.text)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{translate('components.plan-review.title', 'Review plan')}</SheetTitle>
          {plan.truncated ? (
            <SheetDescription>
              {translate(
                'components.plan-review.truncated',
                'Plan shortened to fit. The full text is in the terminal.'
              )}
            </SheetDescription>
          ) : null}
          {!stillWaitingOnThisPlan ? (
            <SheetDescription className="text-destructive">
              {translate(
                'components.plan-review.noLongerWaiting',
                'Claude is no longer waiting on this plan.'
              )}
            </SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="scrollbar-sleek flex-1 overflow-y-auto px-4 pb-4">
          {sections.map((section) => (
            <div
              key={section.key}
              className="group relative border-b border-border py-3 last:border-b-0"
            >
              <CommentMarkdown content={section.text} variant="document" />
              {draft.comments
                .filter((comment) => comment.sectionKey === section.key)
                .map((comment) => (
                  <div
                    key={comment.id}
                    className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="whitespace-pre-wrap">{comment.body}</p>
                      <Button variant="ghost" size="xs" onClick={() => removeComment(comment.id)}>
                        {translate('components.plan-review.deleteComment', 'Delete')}
                      </Button>
                    </div>
                  </div>
                ))}
              {commentingSectionKey === section.key ? (
                <div className="mt-2">
                  <MarkdownPreviewAnnotationComposer
                    lineNumber={section.endLine}
                    startLine={section.startLine}
                    onCancel={() => setCommentingSectionKey(null)}
                    onSubmit={async (body) => {
                      addComment(section, body)
                      setCommentingSectionKey(null)
                      return true
                    }}
                  />
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  className="mt-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => setCommentingSectionKey(section.key)}
                >
                  {translate('components.plan-review.comment', 'Comment')}
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-border p-4">
          {generalNoteOpen || draft.generalNote.length > 0 ? (
            <Textarea
              placeholder={translate(
                'components.plan-review.generalNotePlaceholder',
                'Add a general note (optional)'
              )}
              value={draft.generalNote}
              onChange={(event) => persist({ ...draft, generalNote: event.target.value })}
              rows={3}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setGeneralNoteOpen(true)}
            >
              {translate('components.plan-review.addGeneralNote', 'Add a general note')}
            </Button>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={!canRequestChanges || !stillWaitingOnThisPlan}
              onClick={handleRequestChanges}
            >
              {translate('components.plan-review.requestChanges', 'Request changes ({{value0}})', {
                value0: draft.comments.length
              })}
            </Button>
            <Button disabled={!stillWaitingOnThisPlan} onClick={handleApprove}>
              {translate('components.plan-review.approve', 'Approve')}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
