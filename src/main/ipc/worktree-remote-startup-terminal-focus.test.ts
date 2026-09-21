import { describe, expect, it, vi } from 'vitest'
import { spawnLocalStartupAndSetupTerminals } from './worktree-remote'
import type { KoluxRuntimeService } from '../runtime/kolux-runtime'
import type { GlobalSettings } from '../../shared/global-settings-types'

function makeRuntime(createTerminal: ReturnType<typeof vi.fn>): KoluxRuntimeService {
  return { createTerminal } as unknown as KoluxRuntimeService
}

describe('spawnLocalStartupAndSetupTerminals focus flag', () => {
  const worktree = { id: 'wt-1', path: '/repo/wt-1' }
  const startup = { command: 'claude' }
  const settings = {} as GlobalSettings

  it("keeps activate:true (today's default) when focusStartupTerminal is omitted", async () => {
    const createTerminal = vi.fn().mockResolvedValue({ handle: 'h1', surface: 'visible' })
    await spawnLocalStartupAndSetupTerminals({
      runtime: makeRuntime(createTerminal),
      worktree,
      startup,
      setup: undefined,
      defaultTabs: undefined,
      settings,
      createdWithAgent: undefined
    })

    expect(createTerminal).toHaveBeenCalledTimes(1)
    const [, opts] = createTerminal.mock.calls[0] as [string, Record<string, unknown>]
    expect(opts.activate).toBe(true)
    expect(opts.surfaceOwner).toBeUndefined()
  })

  it('passes activate:false and surfaceOwner:false when focusStartupTerminal is false', async () => {
    // Why: this is the exact call a background batch launch relies on — main must
    // still spawn the real agent process, just never focus/reveal its terminal.
    const createTerminal = vi.fn().mockResolvedValue({ handle: 'h1', surface: 'background' })
    await spawnLocalStartupAndSetupTerminals({
      runtime: makeRuntime(createTerminal),
      worktree,
      startup,
      setup: undefined,
      defaultTabs: undefined,
      settings,
      createdWithAgent: undefined,
      focusStartupTerminal: false
    })

    expect(createTerminal).toHaveBeenCalledTimes(1)
    const [, opts] = createTerminal.mock.calls[0] as [string, Record<string, unknown>]
    expect(opts.activate).toBe(false)
    expect(opts.surfaceOwner).toBe(false)
    // Why: the command must still be the real agent launch, not withheld.
    expect(opts.command).toBe('claude')
  })
})
