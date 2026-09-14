import { describe, expect, it } from 'vitest'
import { getModeSwitchModel } from './ModeSwitch'
import { isTopLevelView } from '../../../shared/top-level-view'

describe('getModeSwitchModel', () => {
  it('selects inbox for the inbox view', () => {
    expect(getModeSwitchModel('inbox').selected).toBe('inbox')
  })

  it('selects floor for the floor view', () => {
    expect(getModeSwitchModel('floor').selected).toBe('floor')
  })

  it('treats every other view as code, including terminal', () => {
    expect(getModeSwitchModel('terminal').selected).toBe('code')
    expect(getModeSwitchModel('settings').selected).toBe('code')
  })

  it('lists the three segments in Inbox, Floor, Code order with their action ids', () => {
    const { items } = getModeSwitchModel('terminal')
    expect(items.map((item) => item.id)).toEqual(['inbox', 'floor', 'code'])
    expect(items.map((item) => item.actionId)).toEqual(['view.inbox', 'view.floor', 'view.code'])
    expect(items.map((item) => item.view)).toEqual(['inbox', 'floor', 'terminal'])
    expect(items.map((item) => item.label)).toEqual(['Inbox', 'Floor', 'Code'])
  })
})

describe('isTopLevelView', () => {
  it('accepts the new inbox and floor top-level views', () => {
    expect(isTopLevelView('inbox')).toBe(true)
    expect(isTopLevelView('floor')).toBe(true)
  })
})
