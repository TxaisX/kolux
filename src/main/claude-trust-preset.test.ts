import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const testState = { fakeHomeDir: '', previousConfigDirEnv: undefined as string | undefined }

vi.mock('node:os', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  const actual = await vi.importActual<typeof import('node:os')>('node:os')
  return { ...actual, homedir: () => testState.fakeHomeDir }
})

const { markClaudeProjectTrusted, toClaudeProjectKey } = await import('./claude-trust-preset')

function configPath(): string {
  return join(testState.fakeHomeDir, '.claude.json')
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(readFileSync(configPath(), 'utf-8'))
}

// Why: Claude only looks up its own key spelling (forward slashes on Windows), so assert on that, not the raw path.
function claudeKey(path: string): string {
  return toClaudeProjectKey(realpathSync.native(path))
}

beforeEach(() => {
  testState.fakeHomeDir = mkdtempSync(join(tmpdir(), 'kolux-claude-trust-'))
  // Why: the real dev/CI environment often runs with CLAUDE_CONFIG_DIR pointed at a live,
  // in-use `.claude.json` (this repo's own AGENTS.md notes CLAUDE_CONFIG_DIR usage) — without
  // clearing it here, ClaudeRuntimePathResolver ignores the mocked homedir() and every write in
  // this suite lands on that real file instead of the throwaway fixture directory.
  testState.previousConfigDirEnv = process.env.CLAUDE_CONFIG_DIR
  delete process.env.CLAUDE_CONFIG_DIR
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  if (testState.previousConfigDirEnv === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = testState.previousConfigDirEnv
  }
  rmSync(testState.fakeHomeDir, { recursive: true, force: true })
  testState.fakeHomeDir = ''
})

describe('markClaudeProjectTrusted', () => {
  it('writes hasTrustDialogAccepted for the workspace after the collection window elapses', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'kolux-claude-ws-'))
    try {
      let settled = false
      const marking = markClaudeProjectTrusted(workspace).then(() => {
        settled = true
      })
      expect(existsSync(configPath())).toBe(false)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(250)
      await marking
      expect(settled).toBe(true)
      const config = readConfig()
      const projects = config.projects as Record<string, { hasTrustDialogAccepted: boolean }>
      expect(projects[claudeKey(workspace)]?.hasTrustDialogAccepted).toBe(true)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('never writes a Windows backslash key, which Claude would ignore', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'kolux-claude-ws-'))
    try {
      const marking = markClaudeProjectTrusted(workspace)
      await vi.advanceTimersByTimeAsync(250)
      await marking
      const keys = Object.keys(readConfig().projects as Record<string, unknown>)
      expect(keys).toEqual([claudeKey(workspace)])
      if (process.platform === 'win32') {
        expect(keys[0]).not.toContain('\\')
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  // Why: this is the bug's actual mechanism — writing worktree N's trust and spawning its agent
  // before worktree N+1's entry exists lets an earlier agent's own startup flush of the shared
  // config drop the later entries (see scratchpad/race-sim.js). Batching every mark that arrives
  // within the window into one write closes that gap.
  it('batches worktrees marked within the same window into a single write, none resolving early', async () => {
    const worktrees = Array.from({ length: 6 }, () =>
      mkdtempSync(join(tmpdir(), 'kolux-claude-wave-'))
    )
    try {
      const settled = worktrees.map(() => false)
      const markings = worktrees.map((path, i) =>
        markClaudeProjectTrusted(path).then(() => {
          settled[i] = true
        })
      )

      await vi.advanceTimersByTimeAsync(100)
      expect(existsSync(configPath())).toBe(false)
      expect(settled.some(Boolean)).toBe(false)

      await vi.advanceTimersByTimeAsync(200)
      await Promise.all(markings)
      expect(settled.every(Boolean)).toBe(true)

      const config = readConfig()
      const projects = config.projects as Record<string, { hasTrustDialogAccepted: boolean }>
      for (const path of worktrees) {
        expect(projects[claudeKey(path)]?.hasTrustDialogAccepted).toBe(true)
      }
    } finally {
      for (const path of worktrees) {
        rmSync(path, { recursive: true, force: true })
      }
    }
  })

  it('resolves without waiting when the workspace is already trusted', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'kolux-claude-ws-'))
    try {
      writeFileSync(
        configPath(),
        JSON.stringify({ projects: { [claudeKey(workspace)]: { hasTrustDialogAccepted: true } } })
      )
      let settled = false
      const marking = markClaudeProjectTrusted(workspace).then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(0)
      await marking
      expect(settled).toBe(true)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('preserves existing config keys and other projects while marking a new one', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'kolux-claude-ws-'))
    try {
      writeFileSync(
        configPath(),
        JSON.stringify({
          numStartups: 4,
          projects: { '/already/trusted': { hasTrustDialogAccepted: true } }
        })
      )
      const marking = markClaudeProjectTrusted(workspace)
      await vi.advanceTimersByTimeAsync(250)
      await marking

      const config = readConfig()
      expect(config.numStartups).toBe(4)
      const projects = config.projects as Record<string, { hasTrustDialogAccepted: boolean }>
      expect(projects['/already/trusted']?.hasTrustDialogAccepted).toBe(true)
      expect(projects[claudeKey(workspace)]?.hasTrustDialogAccepted).toBe(true)
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
