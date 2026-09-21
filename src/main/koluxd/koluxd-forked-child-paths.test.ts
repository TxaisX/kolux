import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppEnvironment } from '../../shared/app-environment'
import { getWatcherProcessEntryPath } from '../ipc/parcel-watcher-entry-path'
import { installKoluxdHostAdapters } from './koluxd-entry'

/**
 * The composition, not the pieces: koluxd's real host adapters against the real resolver
 * and a real deployment layout on disk. Both halves of this passed their own unit tests
 * while the running server forked a path that has never existed in a koluxd deployment.
 */
describe('koluxd forked-child paths', () => {
  let deployRoot: string
  let originalArgv: string[]

  beforeEach(() => {
    deployRoot = mkdtempSync(join(tmpdir(), 'koluxd-deploy-'))
    // The layout build-koluxd.mjs emits: the bundle and its children side by side.
    writeFileSync(join(deployRoot, 'koluxd.js'), '')
    writeFileSync(join(deployRoot, 'parcel-watcher-process-entry.js'), '')
    originalArgv = process.argv
    process.argv = [process.execPath, join(deployRoot, 'koluxd.js')]
    installKoluxdHostAdapters()
  })

  afterEach(() => {
    process.argv = originalArgv
    rmSync(deployRoot, { recursive: true, force: true })
  })

  it('forks the watcher child shipped beside koluxd.js', () => {
    expect(getWatcherProcessEntryPath()).toBe(join(deployRoot, 'parcel-watcher-process-entry.js'))
  })

  it('ignores a decoy child under the working directory', () => {
    // A cwd-derived app root finds the real child only when the operator happens to
    // launch from the install directory, which a supervisor never does — and here it
    // would find someone else's build instead.
    const elsewhere = mkdtempSync(join(tmpdir(), 'koluxd-cwd-'))
    mkdirSync(join(elsewhere, 'out', 'main'), { recursive: true })
    writeFileSync(join(elsewhere, 'out', 'main', 'parcel-watcher-process-entry.js'), '')
    writeFileSync(join(elsewhere, 'parcel-watcher-process-entry.js'), '')
    const originalCwd = process.cwd()
    process.chdir(elsewhere)
    try {
      expect(getWatcherProcessEntryPath()).toBe(join(deployRoot, 'parcel-watcher-process-entry.js'))
    } finally {
      process.chdir(originalCwd)
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  it('reports the install root and the Node binary, not the data directory', () => {
    const environment = getAppEnvironment()
    expect(environment.getAppPath()).toBe(deployRoot)
    expect(environment.getPath('exe')).toBe(process.execPath)
    expect(environment.getPath('exe')).not.toBe(environment.getPath('userData'))
  })
})
