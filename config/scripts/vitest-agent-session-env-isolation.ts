import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

/**
 * Why: a suite run from inside a Claude Code / Codex / Kolux pane inherits that live session's
 * env. CLAUDE_CONFIG_DIR and CODEX_HOME then route "fake home" hook installs into the
 * developer's real ~/.claude and Codex homes, and pane vars (hook port/token, pane key) change
 * code paths, so results depend on who ran them. Suites that need these set them explicitly.
 */
const INHERITED_AGENT_SESSION_ENV = /^(CLAUDE_CONFIG_DIR$|CODEX_HOME$|NIGHTSHIFT_|KOLUX_)/
const KEPT = new Set(['KOLUX_BACKGROUND_LAUNCH', 'NIGHTSHIFT_BACKGROUND_LAUNCH'])

for (const name of Object.keys(process.env)) {
  if (INHERITED_AGENT_SESSION_ENV.test(name) && !KEPT.has(name)) {
    delete process.env[name]
  }
}

// Why: code under test writes ~/.kolux, ~/.codex and ~/.claude via homedir(); on a developer
// machine that is the live install. Git keeps the real identity so commit fixtures still work.
const realGlobalGitConfig = join(homedir(), '.gitconfig')
const sandboxHome = mkdtempSync(join(tmpdir(), 'kolux-vitest-home-'))
if (!process.env.GIT_CONFIG_GLOBAL && existsSync(realGlobalGitConfig)) {
  process.env.GIT_CONFIG_GLOBAL = realGlobalGitConfig
}
process.env.HOME = sandboxHome
process.env.USERPROFILE = sandboxHome

// Why: forks reuse one process across files; a node-env file that assigns globalThis.window and
// never removes it makes the next happy-dom file keep that stub, then delete it on teardown, so
// every later DOM file on that worker fails with "window is not defined" (full-suite only).
const globalsAtStart = new Set(Object.getOwnPropertyNames(globalThis))

afterAll(() => {
  for (const name of Object.getOwnPropertyNames(globalThis)) {
    if (!globalsAtStart.has(name)) {
      Reflect.deleteProperty(globalThis, name)
    }
  }
  rmSync(sandboxHome, { recursive: true, force: true })
})
