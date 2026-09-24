import { connectSshTestTarget } from './helpers/ssh-test-target-connection'
import os from 'node:os'
import { createSeededTestRepo } from './helpers/seeded-test-repo'
import { cleanupTestRepository } from './global-teardown'

import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/kolux-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  UUID_RE,
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

type LocalhostSshTarget = {
  label: string
  host: string
  port: number
  username: string
  configHost?: string
  identityFile?: string
}

const RUN_LOCALHOST_SSH = process.env.KOLUX_E2E_SSH_LOCALHOST === '1'
const RUN_REMOTE_HOOKS =
  process.env.KOLUX_FEATURE_REMOTE_AGENT_HOOKS === undefined ||
  (process.env.KOLUX_FEATURE_REMOTE_AGENT_HOOKS.trim() !== '' &&
    process.env.KOLUX_FEATURE_REMOTE_AGENT_HOOKS.trim() !== '0')

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? '22')
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed
  }
  throw new Error(`Invalid KOLUX_E2E_SSH_PORT: ${value}`)
}

function currentUsername(): string {
  return (
    process.env.KOLUX_E2E_SSH_USER ??
    process.env.USER ??
    process.env.USERNAME ??
    os.userInfo().username
  )
}

function readLocalhostSshTarget(): LocalhostSshTarget {
  const configHost = process.env.KOLUX_E2E_SSH_CONFIG_HOST?.trim()
  const host = process.env.KOLUX_E2E_SSH_HOST?.trim() ?? (configHost ? '' : '127.0.0.1')
  const identityFile = process.env.KOLUX_E2E_SSH_IDENTITY_FILE?.trim()

  return {
    label: `Localhost SSH E2E ${Date.now()}`,
    host,
    port: parsePort(process.env.KOLUX_E2E_SSH_PORT),
    username: currentUsername(),
    ...(configHost ? { configHost } : {}),
    ...(identityFile ? { identityFile } : {})
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function marker(name: string): string {
  return `__KOLUX_${name}_${Date.now()}__`
}

function emitMarkerCommand(value: string): string {
  const midpoint = Math.floor(value.length / 2)
  return `printf '%s%s\\n' ${shellQuote(value.slice(0, midpoint))} ${shellQuote(
    value.slice(midpoint)
  )}`
}

async function focusTerminal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('Store unavailable')
    }
    const state = store.getState()
    const worktreeId = state.activeWorktreeId
    if (!worktreeId) {
      throw new Error('No active worktree')
    }
    const tabId =
      state.activeTabType === 'terminal'
        ? state.activeTabId
        : (state.activeTabIdByWorktree?.[worktreeId] ?? null)
    if (!tabId) {
      throw new Error('No active terminal tab')
    }
    const manager = window.__paneManagers?.get(tabId)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
    if (!pane) {
      throw new Error('No active terminal pane')
    }
    pane.terminal.focus()
  })
}

async function postCodexHook(
  page: Page,
  ptyId: string,
  payload: Record<string, unknown>,
  markerName: string
): Promise<void> {
  const hookPostedMarker = marker(markerName)
  // Why: a foreground curl command emits the shell's command-finished marker
  // immediately after the hook, which correctly clears a same-turn agent row.
  // Post from a delayed background subshell so this test observes hook routing.
  await execInTerminal(
    page,
    ptyId,
    [
      'if [ -z "$KOLUX_AGENT_HOOK_PORT" ] || [ -z "$KOLUX_AGENT_HOOK_TOKEN" ] || [ -z "$KOLUX_PANE_KEY" ]; then',
      '  echo __KOLUX_AGENT_HOOK_ENV_MISSING__',
      'else',
      `  hook_payload=${shellQuote(JSON.stringify(payload))}`,
      '  (',
      '    sleep 0.1',
      '    if curl -sS -X POST "http://127.0.0.1:${KOLUX_AGENT_HOOK_PORT}/hook/codex" \\',
      '      -H "Content-Type: application/x-www-form-urlencoded" \\',
      '      -H "X-Kolux-Agent-Hook-Token: ${KOLUX_AGENT_HOOK_TOKEN}" \\',
      '      --data-urlencode "paneKey=${KOLUX_PANE_KEY}" \\',
      '      --data-urlencode "tabId=${KOLUX_TAB_ID}" \\',
      '      --data-urlencode "worktreeId=${KOLUX_WORKTREE_ID}" \\',
      '      --data-urlencode "env=${KOLUX_AGENT_HOOK_ENV}" \\',
      '      --data-urlencode "version=${KOLUX_AGENT_HOOK_VERSION}" \\',
      '      --data-urlencode "payload=${hook_payload}" >/dev/null; then',
      `      ${emitMarkerCommand(hookPostedMarker)}`,
      '    fi',
      '  ) &',
      'fi'
    ].join('\n')
  )
  await waitForTerminalOutput(page, hookPostedMarker, 20_000)
}

test.describe('Localhost SSH', () => {
  test.skip(
    !RUN_LOCALHOST_SSH,
    'Set KOLUX_E2E_SSH_LOCALHOST=1 to run this local-machine-only SSH E2E test.'
  )
  test.skip(
    !RUN_REMOTE_HOOKS,
    'Unset KOLUX_FEATURE_REMOTE_AGENT_HOOKS or set it to 1 so remote PTYs keep pane identity and forward hook events.'
  )
  test.skip(process.platform === 'win32', 'Localhost SSH hook E2E uses POSIX hook scripts.')

  test('routes a terminal and agent-hook status over localhost SSH', async ({
    koluxPage,
    registerPostElectronShutdownCleanup
  }) => {
    test.slow()
    // The relay persists workspace sessions by path across fresh client profiles.
    const testRepoPath = createSeededTestRepo({ publishPath: false })
    registerPostElectronShutdownCleanup(async () => cleanupTestRepository(testRepoPath))
    await waitForSessionReady(koluxPage)
    await waitForActiveWorktree(koluxPage)

    const target = readLocalhostSshTarget()
    const remote = await connectSshTestTarget(
      koluxPage,
      // Limit orphan relay lifetime if the test app exits before cleanup.
      { ...target, relayGracePeriodSeconds: 1 },
      { remotePath: testRepoPath, displayName: 'Localhost SSH E2E' }
    ).catch((error: unknown) => {
      throw new Error(
        `Failed to prepare localhost SSH target ${target.username}@${target.host || target.configHost}:${target.port}. ` +
          `Ensure sshd is running and key/agent auth is non-interactive. ${String(error)}`,
        { cause: error }
      )
    })

    await expect(remote.targetId).toBeTruthy()
    await ensureTerminalVisible(koluxPage, 30_000)
    await waitForActiveTerminalManager(koluxPage, 45_000)
    const ptyId = await waitForActivePanePtyId(koluxPage, 45_000)
    const paneKey = await koluxPage.evaluate(() => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      const state = store.getState()
      const worktreeId = state.activeWorktreeId
      if (!worktreeId) {
        throw new Error('No active worktree')
      }
      const tabs = state.tabsByWorktree[worktreeId] ?? []
      const tabId =
        state.activeTabType === 'terminal'
          ? state.activeTabId
          : (state.activeTabIdByWorktree?.[worktreeId] ?? tabs[0]?.id)
      if (!tabId) {
        throw new Error('No active terminal tab')
      }
      const manager = window.__paneManagers?.get(tabId)
      const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0]
      if (!pane) {
        throw new Error('No active terminal pane')
      }
      return `${tabId}:${pane.leafId}`
    })
    const paneKeyLeafId = paneKey.slice(paneKey.indexOf(':') + 1)
    expect(paneKeyLeafId).toMatch(UUID_RE)
    await koluxPage.evaluate(() => {
      const state = window as unknown as {
        __sshAgentStatusEvents?: unknown[]
        __sshAgentStatusUnsubscribe?: () => void
      }
      state.__sshAgentStatusEvents = []
      state.__sshAgentStatusUnsubscribe?.()
      state.__sshAgentStatusUnsubscribe = window.api.agentStatus.onSet((event) => {
        state.__sshAgentStatusEvents?.push(event)
      })
    })

    const terminalMarker = marker('LOCALHOST_SSH')
    await execInTerminal(koluxPage, ptyId, emitMarkerCommand(terminalMarker))
    await waitForTerminalOutput(koluxPage, terminalMarker, 20_000)

    const envMarker = marker('AGENT_HOOK_ENV_OK')
    const envFailedMarker = marker('AGENT_HOOK_ENV_BAD')
    await execInTerminal(
      koluxPage,
      ptyId,
      [
        `if [ "$KOLUX_PANE_KEY" = ${shellQuote(paneKey)} ] && [ -n "$KOLUX_AGENT_HOOK_PORT" ] && [ -n "$KOLUX_AGENT_HOOK_TOKEN" ] && /bin/sh -c 'test -n "$KOLUX_PANE_KEY" && test -n "$KOLUX_AGENT_HOOK_PORT" && test -n "$KOLUX_AGENT_HOOK_TOKEN"'; then`,
        `  ${emitMarkerCommand(envMarker)}`,
        'else',
        '  token_state=${KOLUX_AGENT_HOOK_TOKEN:+set}',
        `  printf '%s pane=%s port=%s token=%s endpoint=%s\\n' ${shellQuote(envFailedMarker)} "$KOLUX_PANE_KEY" "$KOLUX_AGENT_HOOK_PORT" "$token_state" "$KOLUX_AGENT_HOOK_ENDPOINT"`,
        'fi'
      ].join('\n')
    )
    await waitForTerminalOutput(koluxPage, envMarker, 20_000)

    const pluginOverlayMarker = marker('AGENT_PLUGIN_OVERLAYS_OK')
    const pluginOverlayFailedMarker = marker('AGENT_PLUGIN_OVERLAYS_BAD')
    await execInTerminal(
      koluxPage,
      ptyId,
      [
        'pi_status_file="$HOME/.pi/agent/extensions/kolux-agent-status.ts"',
        'if [ -f "$pi_status_file" ]; then',
        `  ${emitMarkerCommand(pluginOverlayMarker)}`,
        'else',
        `  printf '%s pi_file=%s\\n' ${shellQuote(pluginOverlayFailedMarker)} "$pi_status_file"`,
        'fi'
      ].join('\n')
    )
    await waitForTerminalOutput(koluxPage, pluginOverlayMarker, 20_000)

    const prompt = `kolux ssh e2e prompt ${Date.now()}`
    await postCodexHook(
      koluxPage,
      ptyId,
      { hook_event_name: 'UserPromptSubmit', prompt },
      'AGENT_HOOK_POSTED'
    )

    await expect
      .poll(
        async () =>
          koluxPage.evaluate(
            ({ paneKey, prompt, targetId, worktreeId }) => {
              const state = window.__store?.getState()
              const entries = Object.values(state?.agentStatusByPaneKey ?? {})
              return entries.some(
                (entry) =>
                  entry.paneKey === paneKey &&
                  entry.prompt === prompt &&
                  entry.agentType === 'codex' &&
                  entry.state === 'working' &&
                  state?.repos.some((repo) => repo.connectionId === targetId) === true &&
                  Object.values(state?.worktreesByRepo ?? {})
                    .flat()
                    .some((worktree) => worktree.id === worktreeId)
              )
            },
            { paneKey, prompt, targetId: remote.targetId, worktreeId: remote.worktreeId }
          ),
        {
          timeout: 20_000,
          message: 'Remote Codex hook status did not reach the renderer agent-status store'
        }
      )
      .toBe(true)

    const ctrlPrompt = `kolux ssh ctrl-c interrupt ${Date.now()}`
    await postCodexHook(
      koluxPage,
      ptyId,
      { hook_event_name: 'UserPromptSubmit', prompt: ctrlPrompt },
      'AGENT_HOOK_CTRL_WORKING'
    )
    await focusTerminal(koluxPage)
    await koluxPage.keyboard.press('Control+C')
    await koluxPage.waitForTimeout(750)
    expect(
      await koluxPage.evaluate(
        ({ paneKey, prompt, targetId, worktreeId }) => {
          const state = window.__store?.getState()
          const entry = state?.agentStatusByPaneKey[paneKey]
          const events =
            (
              window as unknown as {
                __sshAgentStatusEvents?: {
                  prompt?: string
                  connectionId?: string | null
                  worktreeId?: string
                }[]
              }
            ).__sshAgentStatusEvents ?? []
          return {
            state: entry?.state,
            interrupted: entry?.interrupted,
            prompt: entry?.prompt,
            eventMatched: events.some(
              (event) =>
                event.prompt === prompt &&
                event.connectionId === targetId &&
                event.worktreeId === worktreeId
            )
          }
        },
        { paneKey, prompt: ctrlPrompt, targetId: remote.targetId, worktreeId: remote.worktreeId }
      )
    ).toEqual({
      state: 'working',
      interrupted: undefined,
      prompt: ctrlPrompt,
      eventMatched: true
    })

    await postCodexHook(
      koluxPage,
      ptyId,
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'exec_command',
        tool_input: { cmd: '/bin/sleep 90' }
      },
      'AGENT_HOOK_LATE_WORKING'
    )
    await expect
      .poll(
        () =>
          koluxPage.evaluate(
            ({ paneKey }) => {
              const entry = window.__store?.getState().agentStatusByPaneKey[paneKey]
              return {
                state: entry?.state,
                interrupted: entry?.interrupted,
                prompt: entry?.prompt
              }
            },
            { paneKey }
          ),
        { timeout: 5_000, message: 'Late remote working hook did not remain working' }
      )
      .toEqual({ state: 'working', interrupted: undefined, prompt: ctrlPrompt })

    const escapePrompt = `kolux ssh escape interrupt ${Date.now()}`
    await postCodexHook(
      koluxPage,
      ptyId,
      { hook_event_name: 'UserPromptSubmit', prompt: escapePrompt },
      'AGENT_HOOK_ESCAPE_WORKING'
    )
    await focusTerminal(koluxPage)
    await koluxPage.keyboard.press('Escape')
    await koluxPage.waitForTimeout(750)
    expect(
      await koluxPage.evaluate(
        ({ paneKey }) => {
          const entry = window.__store?.getState().agentStatusByPaneKey[paneKey]
          return {
            state: entry?.state,
            interrupted: entry?.interrupted,
            prompt: entry?.prompt
          }
        },
        { paneKey }
      )
    ).toEqual({ state: 'working', interrupted: undefined, prompt: escapePrompt })
  })
})
