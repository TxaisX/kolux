import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { predictWorktreeMergeTreeConflict } from './worktree-merge-tree-prediction'

const tempRoots: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim()
}

async function createRepoWithTwoWorktrees(): Promise<{
  repoPath: string
  worktreeAPath: string
  worktreeBPath: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'kolux-overlap-merge-tree-'))
  tempRoots.push(root)
  const repoPath = join(root, 'repo')
  execFileSync('git', ['init', '--quiet', repoPath])
  git(repoPath, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  git(repoPath, ['config', 'user.email', 'test@example.com'])
  git(repoPath, ['config', 'user.name', 'Test User'])
  await writeFile(join(repoPath, 'shared.txt'), 'line1\n')
  await writeFile(join(repoPath, 'other.txt'), 'unrelated\n')
  git(repoPath, ['add', 'shared.txt', 'other.txt'])
  git(repoPath, ['commit', '--quiet', '-m', 'initial'])

  const worktreeAPath = join(root, 'worktree-a')
  const worktreeBPath = join(root, 'worktree-b')
  git(repoPath, ['worktree', 'add', '-b', 'agent-a', worktreeAPath])
  git(repoPath, ['worktree', 'add', '-b', 'agent-b', worktreeBPath])

  return { repoPath, worktreeAPath, worktreeBPath }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('predictWorktreeMergeTreeConflict with real Git', () => {
  it('predicts conflicts when two sibling worktrees edit the same line', async () => {
    const { repoPath, worktreeAPath, worktreeBPath } = await createRepoWithTwoWorktrees()
    await writeFile(join(worktreeAPath, 'shared.txt'), 'agent-a-change\n')
    git(worktreeAPath, ['commit', '--quiet', '-am', 'agent a edits shared.txt'])
    await writeFile(join(worktreeBPath, 'shared.txt'), 'agent-b-change\n')
    git(worktreeBPath, ['commit', '--quiet', '-am', 'agent b edits shared.txt'])

    const headA = git(worktreeAPath, ['rev-parse', 'HEAD'])
    const headB = git(worktreeBPath, ['rev-parse', 'HEAD'])

    const result = await predictWorktreeMergeTreeConflict(repoPath, headA, headB)
    expect(result.prediction).toBe('conflicts')
    expect(result.conflictingFiles).toContain('shared.txt')
  })

  it('predicts clean when sibling worktrees edit different files', async () => {
    const { repoPath, worktreeAPath, worktreeBPath } = await createRepoWithTwoWorktrees()
    await writeFile(join(worktreeAPath, 'shared.txt'), 'agent-a-change\n')
    git(worktreeAPath, ['commit', '--quiet', '-am', 'agent a edits shared.txt'])
    await writeFile(join(worktreeBPath, 'other.txt'), 'agent-b-change\n')
    git(worktreeBPath, ['commit', '--quiet', '-am', 'agent b edits other.txt'])

    const headA = git(worktreeAPath, ['rev-parse', 'HEAD'])
    const headB = git(worktreeBPath, ['rev-parse', 'HEAD'])

    const result = await predictWorktreeMergeTreeConflict(repoPath, headA, headB)
    expect(result).toEqual({ prediction: 'clean', conflictingFiles: [] })
  })
})
