import { readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SshRemotePtyLeaseState } from '../shared/ssh-types'

export const BACKUP_COUNT = 5
export const BACKUP_MIN_INTERVAL_MS = 60 * 60 * 1000
export const PAST_ROTATION_INTERVAL_MS = BACKUP_MIN_INTERVAL_MS * 2
export const SAVE_DEBOUNCE_MS = 1_000

export const ROTATION_INTERLEAVE_CASES = [
  ['initial access', 'access', ''],
  ['oldest removal', 'rm', '.bak.4'],
  ['slot access', 'access', '.bak.0'],
  ['slot rename', 'rename', '.bak.0'],
  ['final copy', 'copyFile', '']
] as const

export type TestStore = {
  updateUI(updates: { sidebarWidth: number }): void
  setGitHubCache(cache: { pr: Record<string, never>; issue: Record<string, never> }): void
  waitForPendingWrite(): Promise<void>
  flushOrThrow(): void
  flushPendingAsync(): Promise<void>
  flushPendingOrThrowAsync(options?: { drainToStableGeneration?: boolean }): Promise<void>
  upsertSshPtyConsumerRecovery(record: {
    targetId: string
    clientInstanceId: string
    serverBuildId: string
    clientGeneration: number
    ownerGeneration: number
    ownerLease: string
  }): Promise<void>
  removeSshPtyConsumerRecovery(targetId: string): Promise<void>
  upsertSshRemotePtyLease(lease: {
    targetId: string
    ptyId: string
    state: SshRemotePtyLeaseState
  }): void
  markSshRemotePtyLeasesAsync(targetId: string, state: SshRemotePtyLeaseState): Promise<void>
  markSshRemotePtyLeasesAttachedAsync(targetId: string, ptyIds: readonly string[]): Promise<void>
}

export function consumerRecovery(clientInstanceId: string) {
  return {
    targetId: 'ssh-1',
    clientInstanceId,
    serverBuildId: 'relay-build-1',
    clientGeneration: 3,
    ownerGeneration: 5,
    ownerLease: 'secret-owner-lease'
  }
}

export function dataFile(dir: string): string {
  return join(dir, 'kolux-data.json')
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

export function seedStaleBackup(dir: string): void {
  const path = `${dataFile(dir)}.bak.0`
  writeFileSync(path, '{"stale":true}', 'utf-8')
  const staleSeconds = (Date.now() - PAST_ROTATION_INTERVAL_MS) / 1000
  utimesSync(path, staleSeconds, staleSeconds)
}

export function ringSnapshot(dir: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  for (const name of readdirSync(dir).sort()) {
    if (name === 'kolux-data.json' || name.startsWith('kolux-data.json.bak.')) {
      snapshot[name] = readFileSync(join(dir, name), 'utf-8')
    }
  }
  return snapshot
}
