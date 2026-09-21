import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceHandoffStore } from './workspace-handoff-store'

describe('WorkspaceHandoffStore', () => {
  let dir: string

  function makeStore(): WorkspaceHandoffStore {
    dir = mkdtempSync(join(tmpdir(), 'kolux-workspace-handoff-'))
    return new WorkspaceHandoffStore(() => dir)
  }

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns null for a key that was never written', () => {
    const store = makeStore()
    expect(store.read('abc123')).toBeNull()
  })

  it('writes then reads back the same text', () => {
    const store = makeStore()
    store.write('abc123', '# handoff\ndo the thing')
    const record = store.read('abc123')
    expect(record?.text).toBe('# handoff\ndo the thing')
    expect(typeof record?.updatedAt).toBe('number')
  })

  it('keeps documents for different keys independent', () => {
    const store = makeStore()
    store.write('key-one', 'one')
    store.write('key-two', 'two')
    expect(store.read('key-one')?.text).toBe('one')
    expect(store.read('key-two')?.text).toBe('two')
  })

  it('overwrites a document atomically (no temp file left behind)', () => {
    const store = makeStore()
    store.write('abc123', 'first')
    store.write('abc123', 'second')
    expect(store.read('abc123')?.text).toBe('second')
    const leftoverTmp = existsSync(join(dir, 'abc123.json.tmp'))
    expect(leftoverTmp).toBe(false)
  })

  it('creates the directory on first write', () => {
    const nested = join(mkdtempSync(join(tmpdir(), 'kolux-workspace-handoff-')), 'nested')
    const store = new WorkspaceHandoffStore(() => nested)
    store.write('abc123', 'text')
    expect(readFileSync(join(nested, 'abc123.json'), 'utf-8')).toContain('text')
    rmSync(nested, { recursive: true, force: true })
  })

  it('returns null for a corrupted document instead of throwing', () => {
    const store = makeStore()
    store.write('abc123', 'ok')
    writeFileSync(join(dir, 'abc123.json'), 'not json')
    expect(store.read('abc123')).toBeNull()
  })
})
