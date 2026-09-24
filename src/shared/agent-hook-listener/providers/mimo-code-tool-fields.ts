import { capHookMessageText } from '../listener-limits'
import type { ToolSnapshot } from '../listener-event'
import { hasAnyOwnField, hasOwnField, readString, toolUpdate } from '../tool-input-preview'
import {
  deriveInteractivePrompt,
  readFirstString,
  stripHookEnvelopeKeys
} from '../interactive-tool'

/**
 * Retires any cached tool fields. PermissionRequest is the only MiMo Code event that
 * carries them, and this family has no mid-session isNewTurnEvent boundary, so nothing
 * else resets the cache mid-session. Without an explicit retire, resolveToolState inherits
 * one answered permission onto every later frame in the pane and the row reads a resolved
 * command as the live tool.
 */
const MIMO_TOOL_FIELDS_RETIRED: ToolSnapshot = {
  hasToolUpdate: true,
  hasToolInputField: true
}

export function extractMimoCodeToolFields(
  eventName: unknown,
  hookPayload: Record<string, unknown>
): ToolSnapshot {
  if (eventName === 'MessagePart' && hookPayload.role === 'assistant') {
    const text = readString(hookPayload, 'text')
    if (text) {
      return { ...MIMO_TOOL_FIELDS_RETIRED, lastAssistantMessage: capHookMessageText(text) }
    }
  }
  if (eventName === 'AskUserQuestion') {
    // Why: MiMo's payload is question.asked's event.properties (hook_event_name merged in); strip envelope or use tool_input, capture JSON for the card.
    const toolInputSource = hasOwnField(hookPayload, 'tool_input')
      ? hookPayload.tool_input
      : stripHookEnvelopeKeys(hookPayload)
    return {
      ...MIMO_TOOL_FIELDS_RETIRED,
      interactivePrompt: deriveInteractivePrompt('AskUserQuestion', toolInputSource)
    }
  }
  if (eventName === 'PermissionRequest') {
    // Why: the payload is permission.asked's event.properties — `permission` names what is
    // being requested and `metadata`/`patterns` say which command or path it covers. Without
    // them the row is a bare 'waiting' that cannot tell the user what to approve.
    // The SDK types `metadata` as Record<string, unknown>, so these keys come from the tools
    // themselves: bash sends `command`, edit sends `filepath`, webfetch sends `url`.
    // `file_path`/`path` cover tools that spell it the common way.
    // `diff` is deliberately absent — edit ships the whole patch and it would swamp the row.
    const metadata = hookPayload.metadata
    const metadataInput =
      metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)
        ? readFirstString(metadata as Record<string, unknown>, [
            'command',
            'filepath',
            'file_path',
            'path',
            'url'
          ])
        : undefined
    const patterns = Array.isArray(hookPayload.patterns)
      ? hookPayload.patterns.filter(
          (pattern): pattern is string => typeof pattern === 'string' && pattern.length > 0
        )
      : []
    return toolUpdate(
      {
        toolName: readString(hookPayload, 'permission'),
        toolInput: metadataInput ?? (patterns.length > 0 ? patterns.join(', ') : undefined)
      },
      { hasToolInputField: hasAnyOwnField(hookPayload, ['metadata', 'patterns']) }
    )
  }
  return MIMO_TOOL_FIELDS_RETIRED
}
