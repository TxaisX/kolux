import { useMemo, useState } from 'react'
import { ClipboardCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import { parseApprovalFromStatus } from '../native-chat/native-chat-interactive-prompt'
import { PlanReviewSheet } from './PlanReviewSheet'

export type PlanReviewButtonProps = {
  tabId: string
  paneKey: string
  getPtyId: () => string | null
}

/** Pane-header entry point for the plan-review sheet: shows only while the
 *  pane's live status carries an ExitPlanMode approval with a plan attached
 *  (old hosts send no `plan`, so this stays hidden for them). */
export function PlanReviewButton({
  tabId,
  paneKey,
  getPtyId
}: PlanReviewButtonProps): React.JSX.Element | null {
  const interactivePrompt = useAppStore(
    (s) => s.agentStatusByPaneKey[paneKey]?.interactivePrompt ?? null
  )
  const plan = useMemo(
    () => parseApprovalFromStatus(interactivePrompt)?.plan ?? null,
    [interactivePrompt]
  )
  const [open, setOpen] = useState(false)
  const label = translate('components.plan-review.reviewPlan', 'Review plan')

  if (!plan) {
    return null
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label={label}
            onClick={(event) => {
              event.stopPropagation()
              setOpen(true)
            }}
          >
            <ClipboardCheck />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {label}
        </TooltipContent>
      </Tooltip>
      <PlanReviewSheet
        key={plan.text}
        open={open}
        onOpenChange={setOpen}
        paneKey={paneKey}
        getPtyId={getPtyId}
        settings={getSettingsForAgentTabRuntimeOwner(tabId)}
        plan={plan}
      />
    </>
  )
}
