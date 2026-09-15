// Pure J/K + arrow-key selection stepping for the Inbox list. Kept separate from
// rendering so the model is testable without mounting InboxList.
import type { InboxGroups, InboxItem } from './inbox-items'

/** Visual row order: Needs you, then Waiting on agent, then Done today. */
export function flattenInboxOrder(groups: InboxGroups): InboxItem[] {
  return [...groups.needs, ...groups.waiting, ...groups.done]
}

/**
 * Next selected id after moving `direction` rows (+1 = down/J, -1 = up/K).
 * No selection yet: down picks the first row, up picks the last. Clamped at the ends.
 */
export function moveInboxSelection(
  order: readonly InboxItem[],
  selectedId: string | null,
  direction: 1 | -1
): string | null {
  if (order.length === 0) {
    return null
  }
  if (selectedId === null) {
    return direction > 0 ? order[0].id : order.at(-1)!.id
  }
  const index = order.findIndex((item) => item.id === selectedId)
  if (index === -1) {
    return order[0].id
  }
  const nextIndex = Math.max(0, Math.min(order.length - 1, index + direction))
  return order[nextIndex].id
}
