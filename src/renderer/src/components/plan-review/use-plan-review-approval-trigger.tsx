import { useState } from 'react'
import { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import { PlanReviewSheet } from './PlanReviewSheet'

export type PlanReviewApprovalTrigger = {
  /** Pass to NativeChatInteractiveCard's onReviewPlan. */
  onReviewPlan: (plan: { text: string; truncated: boolean }) => void
  /** Render as a sibling of NativeChatInteractiveCard. Null until a plan opens. */
  sheet: React.JSX.Element | null
}

/** Owns the plan-review sheet's open state for the native-chat approval
 *  card's "Review plan" button (the pane-header entry point owns its own via
 *  PlanReviewButton). Both read/write the same paneKey+planText draft cache
 *  in plan-review.ts, so switching triggers keeps comments. Split out of
 *  NativeChatResolvedView.tsx to keep it under the file's line budget. */
export function usePlanReviewApprovalTrigger(
  terminalTabId: string,
  paneKey: string,
  getPtyId: () => string | null
): PlanReviewApprovalTrigger {
  const [plan, setPlan] = useState<{ text: string; truncated: boolean } | null>(null)
  const [open, setOpen] = useState(false)

  return {
    onReviewPlan: (nextPlan) => {
      setPlan(nextPlan)
      setOpen(true)
    },
    sheet: plan ? (
      <PlanReviewSheet
        key={plan.text}
        open={open}
        onOpenChange={setOpen}
        paneKey={paneKey}
        getPtyId={getPtyId}
        settings={getSettingsForAgentTabRuntimeOwner(terminalTabId)}
        plan={plan}
      />
    ) : null
  }
}
