#!/usr/bin/env node
// Commit all changes, optionally merge a branch, and push — with a free OpenCode model writing
// the commit message, so Claude/Codex tokens aren't spent on git chores (see AGENTS.md).
// Usage: pnpm ship [--main] [--merge <branch>] [--dry-run] [--model <provider/model>]
//   --main  work is complete: also land it on main, on GitHub and locally.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flagValue = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const model = flagValue('--model') ?? 'opencode/big-pickle'
const mergeBranch = flagValue('--merge')
const dryRun = args.includes('--dry-run')
const toMain = args.includes('--main')
const MAX_DIFF_CHARS = 100_000

function fail(message) {
  console.error(`ship: ${message}`)
  process.exit(1)
}

function git(...gitArgs) {
  const r = spawnSync('git', gitArgs, { encoding: 'utf8', maxBuffer: 256 << 20 })
  if (r.status !== 0) {
    throw new Error(`git ${gitArgs.join(' ')} failed:\n${(r.stderr || r.stdout).trim()}`)
  }
  return r.stdout.trim()
}

function gitOk(...gitArgs) {
  return spawnSync('git', gitArgs, { encoding: 'utf8' }).status === 0
}

// Why: merge (never rebase) so commits already on GitHub are never rewritten.
function pullFromGitHub(branch) {
  if (!gitOk('pull', '--no-rebase', '--no-edit', 'origin', branch)) {
    gitOk('merge', '--abort')
    fail(
      `couldn't bring in GitHub's ${branch} (conflict or network); nothing pushed. Conflicts are code work: hand them to Claude or Codex.`
    )
  }
}

function writeCommitMessage() {
  const stat = git('diff', '--cached', '--stat')
  let diff = git('diff', '--cached')
  if (diff.length > MAX_DIFF_CHARS) {
    diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated]`
  }
  const recent = git('log', '-8', '--format=%s')
  const prompt = [
    'Write a git commit message for the staged changes below.',
    'Match the style of these recent subjects from this repo:',
    recent,
    '',
    'Rules: first line is a plain-English summary under 72 characters, no type prefix.',
    'Optionally add a blank line and up to 5 short lines on what changed and why.',
    'Output ONLY the commit message. No code fences, no preamble.',
    '',
    stat,
    '',
    diff
  ].join('\n')

  if (!/^[\w./#:-]+$/.test(model)) {
    fail(`invalid model id: ${model}`)
  }
  // Why: run outside the repo so the OpenCode agent can't edit tracked files.
  const cwd = mkdtempSync(join(tmpdir(), 'ship-'))
  try {
    const runArgs = ['run', '-m', model, '--format', 'json']
    const options = { cwd, input: prompt, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 << 20 }
    // Why: npm installs opencode as a .cmd shim on Windows, which needs a shell; model id is validated above.
    const r =
      process.platform === 'win32'
        ? spawnSync(['opencode', ...runArgs].join(' '), { ...options, shell: true })
        : spawnSync('opencode', runArgs, options)
    if (r.status !== 0) {
      fail(
        `opencode failed (is it installed? \`npm i -g @opencode/cli\`):\n${r.stderr || r.stdout || r.error}`
      )
    }
    const text = r.stdout
      .split('\n')
      .map((line) => {
        try {
          const event = JSON.parse(line)
          return event.type === 'text' ? (event.part?.text ?? '') : ''
        } catch {
          return ''
        }
      })
      .join('')
      .replace(/^```\w*\n?|```$/gm, '')
      .trim()
    if (!text) {
      fail(`opencode returned no commit message. Raw output:\n${r.stdout}`)
    }
    return text
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}

try {
  git('add', '-A')
  if (git('diff', '--cached', '--name-only')) {
    const message = writeCommitMessage()
    console.log(`--- commit message (${model}) ---\n${message}\n---`)
    if (dryRun) {
      git('reset', '-q')
      console.log('dry run: nothing committed, changes unstaged')
      process.exit(0)
    }
    const commit = spawnSync('git', ['commit', '-F', '-'], {
      input: message,
      stdio: ['pipe', 'inherit', 'inherit']
    })
    if (commit.status !== 0) {
      fail('commit failed (see hook output above)')
    }
  } else {
    console.log('nothing to commit')
  }

  if (mergeBranch) {
    if (!gitOk('merge', '--no-edit', mergeBranch)) {
      gitOk('merge', '--abort')
      fail(
        `merging ${mergeBranch} hit conflicts; merge aborted. Conflict resolution is code work: hand it to Claude or Codex.`
      )
    }
    console.log(`merged ${mergeBranch}`)
  }

  if (!dryRun) {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
    if (toMain && branch !== 'main') {
      pullFromGitHub('main')
    }
    if (!gitOk('push', '-u', 'origin', 'HEAD')) {
      pullFromGitHub(branch)
      git('push', '-u', 'origin', 'HEAD')
    }
    console.log(`pushed ${branch} to GitHub`)

    if (toMain && branch !== 'main') {
      git('push', 'origin', 'HEAD:main')
      console.log('pushed to main on GitHub')
      // Why: main is checked out in the primary folder; fast-forward it so local main matches GitHub.
      const mainPath = git('worktree', 'list', '--porcelain')
        .split(/\r?\n\r?\n/)
        .find((entry) => entry.includes('\nbranch refs/heads/main'))
        ?.match(/^worktree (.+)$/m)?.[1]
      const head = git('rev-parse', 'HEAD')
      if (mainPath && gitOk('-C', mainPath, 'merge', '--ff-only', head)) {
        console.log(`local main updated (${mainPath})`)
      } else if (mainPath) {
        console.log(
          `local main in ${mainPath} has overlapping uncommitted edits; run \`git pull\` there once they're shipped`
        )
      } else {
        git('fetch', 'origin', 'main:main')
        console.log('local main updated')
      }
    }
  }
} catch (error) {
  fail(error.message)
}
