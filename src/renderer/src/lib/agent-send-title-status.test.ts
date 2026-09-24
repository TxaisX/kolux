import { describe, expect, it } from 'vitest'
import { detectAgentSendTitleStatus } from './agent-send-title-status'

describe('detectAgentSendTitleStatus', () => {
  it('detects idle/working/no-signal titles', () => {
    expect(detectAgentSendTitleStatus('✦ Gemini CLI')).toBe('working')
    expect(detectAgentSendTitleStatus('Codex ready')).toBe('idle')
    expect(detectAgentSendTitleStatus('zsh')).toBeNull()
  })
})
