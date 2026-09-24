import { describe, expect, it } from 'vitest'
import { isTopLevelView } from './top-level-view'

describe('isTopLevelView', () => {
  it('accepts the inbox and floor top-level views', () => {
    expect(isTopLevelView('inbox')).toBe(true)
    expect(isTopLevelView('floor')).toBe(true)
  })
})
