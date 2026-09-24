import { ClipboardCheck, ShieldQuestion } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { ChatApproval } from './native-chat-interactive-prompt'

export type NativeChatApprovalCardProps = {
  approval: ChatApproval
  /** Send the chosen option's literal string to the agent's PTY. */
  onChoose: (send: string) => void
  /** Opens the plan-review sheet. Present only when `approval.plan` is set. */
  onReviewPlan?: () => void
}

/**
 * Native renderer for an agent tool-approval (PermissionRequest) as an
 * Allow/Deny card. Each button writes its option's literal `send` string back
 * to the agent (a number to allow; ESC to deny). The first option reads as the
 * affirmative action and gets the primary styling.
 */
export function NativeChatApprovalCard({
  approval,
  onChoose,
  onReviewPlan
}: NativeChatApprovalCardProps): React.JSX.Element {
  return (
    <div className="shrink-0 bg-background">
      <div className="mx-auto w-full max-w-4xl px-3 pt-2 pb-1 sm:px-4">
        <div className="flex w-full flex-col gap-2 rounded-lg border border-input bg-card px-4 py-3 shadow-xs">
          <div className="flex items-start gap-2">
            <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{approval.title}</p>
              {approval.detail ? (
                <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground">
                  {approval.detail}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {approval.options.map((opt, i) => (
              <button
                key={`${opt.label}-${i}`}
                type="button"
                onClick={() => onChoose(opt.send)}
                className={cn(
                  'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  i === 0
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'border border-border bg-background text-foreground hover:bg-accent'
                )}
              >
                {opt.label}
              </button>
            ))}
            {onReviewPlan ? (
              <button
                type="button"
                onClick={onReviewPlan}
                className="ml-auto flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ClipboardCheck className="size-4" />
                {translate('components.plan-review.reviewPlan', 'Review plan')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
