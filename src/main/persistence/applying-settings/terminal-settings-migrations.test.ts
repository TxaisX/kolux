import { describe, expect, it } from 'vitest'
import {
  migrateAgentYoloDefaults,
  stripRetiredGlobalSettings
} from './terminal-settings-migrations'

describe('migrateAgentYoloDefaults', () => {
  it('keeps newly added agent defaults manual for already migrated profiles', () => {
    const migrated = migrateAgentYoloDefaults({
      agentYoloDefaultsMigrated: true,
      agentDefaultArgs: { claude: '--dangerously-skip-permissions' },
      agentDefaultEnv: {}
    } as never)

    expect(migrated.agentDefaultArgs?.droid).toBe('')
    expect(migrated.agentDefaultEnv?.goose).toEqual({})
  })
})

describe('stripRetiredGlobalSettings', () => {
  it('drops the retired OpenCode fields from an old profile while keeping the rest', () => {
    const stripped = stripRetiredGlobalSettings({
      workspaceDir: '/home/dev/kolux',
      // Why: an old build persisted these under safeStorage encryption; the
      // exact ciphertext shape does not matter, only that it gets dropped.
      opencodeSessionCookie: 'v10cipher:opaque-encrypted-cookie-bytes',
      opencodeWorkspaceId: 'wrk_legacy_123'
    } as never)

    expect(stripped).not.toHaveProperty('opencodeSessionCookie')
    expect(stripped).not.toHaveProperty('opencodeWorkspaceId')
    expect(stripped.workspaceDir).toBe('/home/dev/kolux')
  })

  it('is a no-op when the retired fields are absent', () => {
    const settings = { workspaceDir: '/home/dev/kolux', nestWorkspaces: true } as never
    expect(stripRetiredGlobalSettings(settings)).toEqual(settings)
  })
})
