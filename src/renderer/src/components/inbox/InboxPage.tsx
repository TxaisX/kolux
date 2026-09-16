import React, { useEffect, useMemo, useState } from 'react'
import { isEditableTarget } from '@/lib/editable-target'
import { InboxList } from './InboxList'
import { InboxDetail } from './InboxDetail'
import { InboxWorktreeSummary } from './InboxWorktreeSummary'
import { useInboxGroups } from './use-inbox-groups'
import { flattenInboxOrder, moveInboxSelection } from './inbox-list-navigation'
import { openInboxItemInCode } from './inbox-open-in-code'

export default function InboxPage(): React.JSX.Element {
  const groups = useInboxGroups()
  const order = useMemo(() => flattenInboxOrder(groups), [groups])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Land on the top item once the Inbox has any, without stealing an explicit selection.
  useEffect(() => {
    if (selectedId === null && order.length > 0) {
      setSelectedId(order[0].id)
    }
  }, [selectedId, order])

  const selectedItem = order.find((item) => item.id === selectedId) ?? null

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isEditableTarget(event.target)) {
        return
      }
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedId((current) => moveInboxSelection(order, current, 1))
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedId((current) => moveInboxSelection(order, current, -1))
      } else if (event.key === 'Enter' && selectedItem) {
        event.preventDefault()
        openInboxItemInCode(selectedItem)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [order, selectedItem])

  return (
    <div className="flex flex-1 min-h-0 min-w-0">
      <InboxList groups={groups} selectedId={selectedId} onSelect={setSelectedId} />
      <InboxDetail item={selectedItem} />
      <InboxWorktreeSummary item={selectedItem} />
    </div>
  )
}
