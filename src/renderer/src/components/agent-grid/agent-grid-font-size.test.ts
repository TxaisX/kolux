import { describe, expect, it } from 'vitest'
import { agentGridFontSize } from './agent-grid-font-size'

describe('agentGridFontSize', () => {
  it('sizes 1-2 tiles at 14', () => {
    expect(agentGridFontSize(1)).toBe(14)
    expect(agentGridFontSize(2)).toBe(14)
  })

  it('sizes 3-4 tiles at 12', () => {
    expect(agentGridFontSize(3)).toBe(12)
    expect(agentGridFontSize(4)).toBe(12)
  })

  it('sizes 5-6 tiles at 11', () => {
    expect(agentGridFontSize(5)).toBe(11)
    expect(agentGridFontSize(6)).toBe(11)
  })

  it('treats zero as the smallest bucket', () => {
    expect(agentGridFontSize(0)).toBe(14)
  })
})
