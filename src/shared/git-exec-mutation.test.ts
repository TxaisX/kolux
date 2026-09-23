import { describe, expect, it } from 'vitest'
import { gitExecMutatesRepository } from './git-exec-mutation'

describe('gitExecMutatesRepository', () => {
  it.each([
    [['remote', 'add', 'pr-contributor-kolux', 'https://github.com/contributor/kolux.git']],
    [['remote', 'remove', 'pr-contributor-kolux']],
    [['clone', '--', 'https://github.com/TxaisX/kolux.git', 'kolux']],
    [['commit', '--allow-empty', '-m', 'Initial commit']],
    [['init']]
  ])('treats %j as mutating', (args) => {
    expect(gitExecMutatesRepository(args)).toBe(true)
  })

  it.each([
    // Why: these run on read-heavy paths; misclassifying them would flush the
    // git read cache on every remote probe.
    [['remote']],
    [['remote', '-v']],
    [['remote', 'get-url', 'origin']],
    [['remote', 'show', 'origin']],
    [['rev-parse', '--show-toplevel']],
    [[]]
  ])('treats %j as read-only', (args) => {
    expect(gitExecMutatesRepository(args)).toBe(false)
  })
})
