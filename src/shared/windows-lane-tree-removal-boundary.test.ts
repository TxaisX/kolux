import { describe, expect, it } from 'vitest'

/**
 * On Windows a recursive tree removal races a handle the OS has not released yet — a just-exited
 * child, an indexer, a dlopen'd native module — so a raw `rmSync(dir, { recursive: true, force:
 * true })` throws EPERM after the test's assertions have all passed, and a green test reports as
 * a failure.
 *
 * `removeTree`/`removeTreeSync` carry the repo's `maxRetries: 8` policy for exactly this. This
 * file guards the scanner logic that would flag a spec hand-rolling the removal instead.
 *
 * Why no repo-wide scan here: the fork split collapsed CI to one ubuntu-only `check` job in
 * `.github/workflows/ci.yml` (the old `pr.yml` windows-2022 lane and its curated
 * "Test Windows-specific boundaries" spec list are gone, confirmed absent even on the pre-rename
 * 0.9.0 baseline) — there is no surviving list of "the windows lane's specs" to read back out of
 * a workflow file. `findRawRecursiveRemovals` is kept and unit-tested in isolation below so a
 * future CI lane, pre-commit hook, or ratchet script can reuse it.
 */

/** `node:fs` and `node:fs/promises`, spelled with or without the `node:` prefix. */
const FS_SPECIFIER = String.raw`['"](?:node:)?fs(?:/promises)?['"]`
/** The `{ … }` clause of an fs import or require, which is where a rename would be declared. */
const FS_BINDING_CLAUSE = new RegExp(
  String.raw`\{([^}]*)\}\s*(?:from\s*${FS_SPECIFIER}|=\s*(?:await\s+import|require)\(\s*${FS_SPECIFIER})`,
  'g'
)
/** `rm as removeDir` or `rmSync: dropTree` — the two ways a binding gets a local name. */
const RENAMED_REMOVAL = /\brm(?:Sync)?\s*(?:as|:)\s*([A-Za-z0-9_$]+)/g

/**
 * The local names a recursive removal can be called by in `source`.
 *
 * Namespaced spellings are covered by the optional `<identifier>.` prefix in the matcher rather
 * than by listing names, so `fsp.rm` and `fsPromises.rm` are caught without anyone having to teach
 * the rule that spelling first. Renames are the one form that prefix cannot see, so they are read
 * out of the import clause.
 */
function collectRemovalNames(source: string): string[] {
  const names = new Set(['rmSync', 'rm'])
  for (const clause of source.matchAll(FS_BINDING_CLAUSE)) {
    for (const rename of clause[1].matchAll(RENAMED_REMOVAL)) {
      names.add(rename[1])
    }
  }
  return [...names]
}

/** Every recursive removal that does not go through the retrying helper. */
function findRawRecursiveRemovals(source: string): number[] {
  const offenders: number[] = []
  const call = new RegExp(
    String.raw`(?<![\w$.])(?:[\w$]+\.)?(?:${collectRemovalNames(source).join('|')})\s*\(`,
    'g'
  )
  let match: RegExpExecArray | null
  while ((match = call.exec(source)) !== null) {
    // Read to the call's closing paren so multi-line option objects are covered.
    let depth = 0
    let end = match.index + match[0].length - 1
    for (; end < source.length; end += 1) {
      if (source[end] === '(') {
        depth += 1
      } else if (source[end] === ')') {
        depth -= 1
        if (depth === 0) {
          break
        }
      }
    }
    const args = source.slice(match.index, end + 1)
    if (!args.includes('recursive')) {
      continue
    }
    if (args.includes('maxRetries')) {
      continue
    }
    offenders.push(source.slice(0, match.index).split('\n').length)
  }
  return offenders
}

describe('windows lane tree removal', () => {
  it('actually detects a raw recursive removal', () => {
    // Without this the scan below passes for any reason at all, including not scanning.
    expect(findRawRecursiveRemovals('rmSync(dir, { recursive: true, force: true })')).toEqual([1])
    expect(
      findRawRecursiveRemovals(
        'await rm(dir, {\n  recursive: true,\n  force: true,\n  maxRetries: 8\n})'
      )
    ).toEqual([])
    // A single-file removal is not this rule's business.
    expect(findRawRecursiveRemovals('rmSync(file, { force: true })')).toEqual([])
  })

  it('detects the removal whatever the import spelled it', () => {
    // Why: a rule that only reads one import style stops catching violations the moment someone
    // writes the next one differently — and the guard goes on reporting zero offenders.
    const spellings: [string, string][] = [
      ['bare named import', "import { rmSync } from 'node:fs'\nrmSync(DIR"],
      ['fs namespace', "import * as fs from 'node:fs'\nfs.rmSync(DIR"],
      ['fsp namespace', "import * as fsp from 'node:fs/promises'\nawait fsp.rm(DIR"],
      [
        'fsPromises namespace',
        "import * as fsPromises from 'node:fs/promises'\nawait fsPromises.rm(DIR"
      ],
      ['nodeFs namespace', "import * as nodeFs from 'node:fs'\nnodeFs.rmSync(DIR"],
      ['unprefixed fs specifier', "import * as fs from 'fs'\nfs.rmSync(DIR"],
      [
        'renamed named import',
        "import { rm as removeDir } from 'node:fs/promises'\nawait removeDir(DIR"
      ],
      ['renamed require', "const { rmSync: dropTree } = require('node:fs')\ndropTree(DIR"]
    ]

    for (const [label, prelude] of spellings) {
      const source = `${prelude}, { recursive: true, force: true })`
      expect(findRawRecursiveRemovals(source), `${label} slipped past the scan`).toEqual([2])
    }
  })

  it('still exempts the retrying spellings and single-file removals', () => {
    // The widened matcher must not start reporting the calls the rule is asking people to write.
    expect(
      findRawRecursiveRemovals(
        "import * as fsp from 'node:fs/promises'\nawait fsp.rm(dir, { recursive: true, maxRetries: 8 })"
      )
    ).toEqual([])
    expect(
      findRawRecursiveRemovals(
        "import { rm as removeDir } from 'node:fs/promises'\nawait removeDir(file, { force: true })"
      )
    ).toEqual([])
    // `rm` inside a longer identifier is not a removal call.
    expect(findRawRecursiveRemovals('confirmRemoval(dir, { recursive: true })')).toEqual([])
  })
})
