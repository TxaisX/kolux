import { describe, expect, it } from 'vitest'
import { flattenInboxOrder, moveInboxSelection } from './inbox-list-navigation'
import type { InboxGroups, InboxItem } from './inbox-items'

function makeItem(id: string, kind: InboxItem['kind'] = 'question'): InboxItem {
  return {
    id,
    paneKey: id,
    tabId: 'tab-1',
    worktreeId: 'wt-1',
    kind,
    title: id,
    workspaceLabel: 'ws › main',
    hostLabel: 'This computer',
    agent: 'claude',
    lastMessage: '',
    ageMs: 0
  }
}

const groups: InboxGroups = {
  needs: [makeItem('a'), makeItem('b')],
  waiting: [makeItem('c', 'running')],
  done: [makeItem('d', 'done')]
}

describe('flattenInboxOrder', () => {
  it('orders needs, then waiting, then done', () => {
    expect(flattenInboxOrder(groups).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('moveInboxSelection', () => {
  const order = flattenInboxOrder(groups)

  it('picks the first row moving down with nothing selected', () => {
    expect(moveInboxSelection(order, null, 1)).toBe('a')
  })

  it('picks the last row moving up with nothing selected', () => {
    expect(moveInboxSelection(order, null, -1)).toBe('d')
  })

  it('steps forward and backward', () => {
    expect(moveInboxSelection(order, 'a', 1)).toBe('b')
    expect(moveInboxSelection(order, 'b', -1)).toBe('a')
  })

  it('clamps at the ends', () => {
    expect(moveInboxSelection(order, 'd', 1)).toBe('d')
    expect(moveInboxSelection(order, 'a', -1)).toBe('a')
  })

  it('recovers to the first row if the selected id no longer exists', () => {
    expect(moveInboxSelection(order, 'missing', 1)).toBe('a')
  })

  it('returns null for an empty order', () => {
    expect(moveInboxSelection([], null, 1)).toBeNull()
  })
})
