import { describe, expect, it } from 'vitest'
import type { AgentCatalogEntry } from '@/lib/agent-catalog'
import { getEffortChoices, getRoutableAgents, routeForModelChange } from './model-routing-draft'

function entry(id: AgentCatalogEntry['id']): AgentCatalogEntry {
  return { id, label: id, cmd: id, homepageUrl: 'https://example.test' }
}

describe('getRoutableAgents', () => {
  it('keeps only agents whose catalog supports worker launch preferences', () => {
    const catalog = [entry('claude'), entry('codex'), entry('gemini'), entry('aider')]
    expect(getRoutableAgents(catalog).map((agent) => agent.id)).toEqual(['claude', 'codex'])
  })
})

describe('routeForModelChange', () => {
  it('omits effort for a model with no effort control', () => {
    expect(routeForModelChange('claude', 'haiku', 'high')).toEqual({ model: 'haiku' })
  })

  it('keeps the previous effort when the new model still offers it', () => {
    expect(routeForModelChange('claude', 'sonnet', 'xhigh')).toEqual({
      model: 'sonnet',
      effort: 'xhigh'
    })
  })

  it('resets to the default effort when the new model does not offer the previous one', () => {
    // gpt-5.5 caps at xhigh, so a carried-over 'ultra' is invalid for it.
    expect(routeForModelChange('codex', 'gpt-5.5', 'ultra')).toEqual({
      model: 'gpt-5.5',
      effort: 'medium'
    })
  })

  it('picks the model default effort when there was no previous route (Not set -> a model)', () => {
    expect(routeForModelChange('codex', 'gpt-5.6-luna', undefined)).toEqual({
      model: 'gpt-5.6-luna',
      effort: 'medium'
    })
  })
})

describe('getEffortChoices', () => {
  it('returns null for a model with no effort option', () => {
    expect(getEffortChoices('claude', 'haiku')).toBeNull()
  })

  it('returns the choices for a model with an effort option', () => {
    const choices = getEffortChoices('claude', 'opus')
    expect(choices?.map((choice) => choice.value)).toContain('high')
  })
})
