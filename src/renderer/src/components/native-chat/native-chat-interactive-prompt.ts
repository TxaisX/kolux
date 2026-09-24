import { translate } from '@/i18n/i18n'
import {
  buildAskAnswerKeys,
  buildCodexAskAnswerKeys,
  formatAskAnswer,
  hasAskAnswer,
  parseAskFromStatus,
  registerQuestionTool,
  type AskAnswerKeyGroup,
  type AskAnswerSelection,
  type AskOption,
  type AskPrompt,
  type AskQuestion,
  type InteractiveQuestionParser
} from '../../../../shared/native-chat-ask'

export {
  buildAskAnswerKeys,
  buildCodexAskAnswerKeys,
  formatAskAnswer,
  hasAskAnswer,
  parseAskFromStatus,
  registerQuestionTool,
  type AskAnswerKeyGroup,
  type AskAnswerSelection,
  type AskOption,
  type AskPrompt,
  type AskQuestion,
  type InteractiveQuestionParser
}

export type ChatApproval = {
  title: string
  detail?: string
  options: { label: string; send: string }[]
  /** ExitPlanMode's plan text, carried for the plan-review sheet. Absent for
   *  every other approval (Bash, Read, …) and for old hosts with no plan field. */
  plan?: { text: string; truncated: boolean }
}

export type InteractivePromptCard =
  | { kind: 'question'; prompt: AskPrompt }
  | { kind: 'approval'; approval: ChatApproval }
  | null

const ESCAPE = String.fromCharCode(27)

/** Parse the desktop-only approval envelope; question parsing stays cross-platform. */
export function parseApprovalFromStatus(
  interactivePrompt: string | undefined | null
): ChatApproval | null {
  if (!interactivePrompt) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(interactivePrompt)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') {
    return null
  }
  const approval = (parsed as { approval?: unknown }).approval
  if (!approval || typeof approval !== 'object') {
    return null
  }
  const tool = (approval as { tool?: unknown }).tool
  if (typeof tool !== 'string' || tool.length === 0) {
    return null
  }
  const summary = (approval as { summary?: unknown }).summary
  const planText = (approval as { plan?: unknown }).plan
  const plan =
    typeof planText === 'string' && planText.length > 0
      ? {
          text: planText,
          truncated: (approval as { planTruncated?: unknown }).planTruncated === true
        }
      : undefined
  return {
    title: translate('components.native-chat.approval.title', 'Allow {{value0}}?', {
      value0: tool
    }),
    detail: typeof summary === 'string' && summary.length > 0 ? summary : undefined,
    options: [
      { label: translate('components.native-chat.approval.allow', 'Allow'), send: '1' },
      { label: translate('components.native-chat.approval.deny', 'Deny'), send: ESCAPE }
    ],
    plan
  }
}

export function parseInteractivePrompt(
  interactivePrompt: string | undefined | null,
  toolName?: string
): InteractivePromptCard {
  const prompt = parseAskFromStatus(interactivePrompt, toolName)
  if (prompt) {
    return { kind: 'question', prompt }
  }
  const approval = parseApprovalFromStatus(interactivePrompt)
  return approval ? { kind: 'approval', approval } : null
}
