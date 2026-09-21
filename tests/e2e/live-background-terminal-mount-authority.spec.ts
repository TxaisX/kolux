import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { test as base, expect } from './helpers/kolux-app'
import { waitForSessionReady } from './helpers/store'
import { waitForActivePanePtyId } from './helpers/terminal'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy
} from './helpers/terminal-pty-write-spy'
import { RuntimeClient } from '../../src/cli/runtime-client'
import type {
  RuntimeStatus,
  RuntimeTerminalCreate,
  RuntimeTerminalSummary,
  RuntimeWorktreeCreateResult
} from '../../src/shared/runtime-types'
import { makePaneKey } from '../../src/shared/stable-pane-id'
import { FAKE_AGENT_WINDOWS_SHELL } from './helpers/fake-agent-command-override'
import {
  canaryLedgerPath,
  createSourceRepo,
  fakeCliDir,
  fakeCodexCommand,
  liveTerminalIdentity,
  readDaemonPid,
  readJsonLines,
  readSpawnLedger,
  readWorktreeTerminals,
  seedAgentRecoveryMetadata,
  setupLedgerPath,
  signalLedgerPath,
  spawnLedgerPath,
  terminalIdentity,
  terminalOutput
} from './live-background-terminal-mount-authority-fixtures'
import {
  activateTerminal,
  assertExactPtyReceivedMarker,
  assertLaunchLedgersUnchanged,
  assertLiveInventory,
  assertNoInterruption,
  assertTargetBindings,
  enableTerminalAccessibility,
  faultProjectionAndActivate,
  terminalAccessibility,
  terminalViewportText,
  typeIntoTerminal
} from './live-background-terminal-mount-authority-assertions'

const test = base.extend({
  launchEnv: [
    {
      PATH: `${fakeCliDir}${path.delimiter}${process.env.PATH ?? ''}`,
      KOLUX_E2E_CODEX_SPAWN_LEDGER: spawnLedgerPath,
      KOLUX_E2E_SETUP_LEDGER: setupLedgerPath,
      KOLUX_E2E_CANARY_LEDGER: canaryLedgerPath,
      KOLUX_E2E_SIGNAL_LEDGER: signalLedgerPath
    },
    { option: true }
  ]
})

test.afterEach(() => {
  rmSync(spawnLedgerPath, { force: true })
  rmSync(setupLedgerPath, { force: true })
  rmSync(canaryLedgerPath, { force: true })
  rmSync(signalLedgerPath, { force: true })
})

test.afterAll(() => rmSync(fakeCliDir, { recursive: true, force: true }))

test('adopts runtime-owned agent and Setup PTYs on first mount', async ({
  electronApp,
  koluxPage,
  registerPostElectronShutdownCleanup
}) => {
  const sourceRepo = createSourceRepo()
  let createdWorktreePath: string | null = null
  registerPostElectronShutdownCleanup(async () => {
    if (createdWorktreePath) {
      rmSync(createdWorktreePath, { recursive: true, force: true })
    }
    rmSync(sourceRepo, { recursive: true, force: true })
  })
  await waitForSessionReady(koluxPage)
  await installTerminalPtyWriteSpy(electronApp)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  const added = await client.call<{ repo: { id: string } }>('repo.add', {
    path: sourceRepo,
    kind: 'git'
  })
  const repoId = added.result.repo.id
  await expect
    .poll(() =>
      koluxPage.evaluate(
        async ({ repoId, command, windowsShell }) => {
          const state = window.__store?.getState()
          await state?.fetchRepos()
          const repo = window.__store?.getState().repos.find((candidate) => candidate.id === repoId)
          if (!repo) {
            return false
          }
          await window.__store?.getState().updateRepo(repoId, {
            hookSettings: { ...repo.hookSettings, setupAgentStartupPolicy: 'start-immediately' }
          })
          await window.__store?.getState().updateSettings({
            agentCmdOverrides: { codex: command },
            terminalWindowsShell: windowsShell,
            disabledTuiAgents: [],
            setupScriptLaunchMode: 'new-tab',
            terminalHiddenViewParking: false
          })
          return true
        },
        { repoId, command: fakeCodexCommand, windowsShell: FAKE_AGENT_WINDOWS_SHELL }
      )
    )
    .toBe(true)

  const created = await client.call<RuntimeWorktreeCreateResult>('worktree.create', {
    repo: `id:${repoId}`,
    name: `live-mount-${randomUUID()}`,
    noParent: true,
    activate: false,
    setupDecision: 'run',
    startupAgent: 'codex',
    startupPrompt: 'keep running'
  })
  const worktreeId = created.result.worktree.id
  createdWorktreePath = created.result.worktree.path
  const createdCanary = await client.call<{ terminal: RuntimeTerminalCreate }>('terminal.create', {
    worktree: `id:${worktreeId}`,
    title: 'Unrelated canary',
    command: 'node canary-live.js'
  })
  let originals: RuntimeTerminalSummary[] = []
  await expect
    .poll(async () => {
      originals = await readWorktreeTerminals(client, worktreeId)
      return originals.map(({ connected, writable }) => ({ connected, writable }))
    })
    .toEqual([
      { connected: true, writable: true },
      { connected: true, writable: true },
      { connected: true, writable: true }
    ])
  expect(
    originals.every(
      ({ incarnationId, ptyId }) =>
        typeof incarnationId === 'string' && incarnationId.length > 0 && typeof ptyId === 'string'
    )
  ).toBe(true)
  expect(new Set(originals.map((terminal) => terminal.ptyId)).size).toBe(3)
  expect(new Set(originals.map((terminal) => terminal.incarnationId)).size).toBe(3)
  expect(new Set(originals.map(({ leafId, tabId }) => makePaneKey(tabId, leafId))).size).toBe(3)
  const agent = originals.find((terminal) => terminal.handle === created.result.agentTerminalHandle)
  const canary = originals.find(
    (terminal) => terminal.handle === createdCanary.result.terminal.handle
  )
  const setup = originals.find(
    (terminal) => terminal.handle !== agent?.handle && terminal.handle !== canary?.handle
  )
  expect(agent).toBeTruthy()
  expect(setup).toBeTruthy()
  expect(canary).toBeTruthy()
  await expect.poll(readSpawnLedger).toHaveLength(1)
  await expect.poll(() => readJsonLines<{ pid: number }>(setupLedgerPath)).toHaveLength(1)
  await expect.poll(() => readJsonLines<{ pid: number }>(canaryLedgerPath)).toHaveLength(1)
  const agentPid = readSpawnLedger()[0]!.pid
  const setupPid = readJsonLines<{ pid: number }>(setupLedgerPath)[0]!.pid
  const canaryPid = readJsonLines<{ pid: number }>(canaryLedgerPath)[0]!.pid
  await expect
    .poll(() => terminalOutput(client, agent!.handle))
    .toContain(`LIVE_AGENT_READY:${agentPid}`)
  await expect
    .poll(() => terminalOutput(client, setup!.handle))
    .toContain(`SETUP_READY:${setupPid}`)
  await expect
    .poll(() => terminalOutput(client, canary!.handle))
    .toContain(`CANARY_READY:${canaryPid}`)
  await assertLaunchLedgersUnchanged()
  const beforeStatus = await client.call<RuntimeStatus>('status.get')
  expect(beforeStatus.result.graphStatus).toBe('ready')
  const daemonPid = readDaemonPid(userDataDir)
  const allIdentities = originals.map(terminalIdentity)
  await assertTargetBindings(koluxPage, worktreeId, allIdentities)
  await seedAgentRecoveryMetadata(koluxPage, worktreeId, terminalIdentity(agent!))

  await faultProjectionAndActivate(koluxPage, worktreeId, [agent!, setup!], agent!.tabId)
  const mountedAgentPtyId = await waitForActivePanePtyId(koluxPage)
  await enableTerminalAccessibility(koluxPage, agent!.tabId)
  await expect
    .poll(
      async () => ({
        mountedPtyId: mountedAgentPtyId,
        liveInventory: (await readWorktreeTerminals(client, worktreeId)).map(liveTerminalIdentity),
        visibleOriginalReady: (
          await terminalAccessibility(koluxPage, agent!.tabId).innerText()
        ).includes(`LIVE_AGENT_READY:${agentPid}`),
        processPids: {
          agent: readSpawnLedger().map(({ pid }) => pid),
          setup: readJsonLines<{ pid: number }>(setupLedgerPath).map(({ pid }) => pid),
          canary: readJsonLines<{ pid: number }>(canaryLedgerPath).map(({ pid }) => pid)
        }
      }),
      { timeout: 10_000 }
    )
    .toEqual({
      mountedPtyId: agent!.ptyId,
      liveInventory: originals.map(liveTerminalIdentity),
      visibleOriginalReady: true,
      processPids: { agent: [agentPid], setup: [setupPid], canary: [canaryPid] }
    })
  const agentMarker = `AGENT_KB_${randomUUID().slice(0, 8)}`
  await clearTerminalPtyWriteLog(electronApp)
  await typeIntoTerminal(koluxPage, agent!.tabId, agentMarker)
  await assertExactPtyReceivedMarker(electronApp, agent!.ptyId, agentMarker)
  await expect(terminalAccessibility(koluxPage, agent!.tabId)).toContainText(
    `AGENT_INPUT:${agentPid}:${agentMarker}`
  )
  await expect(terminalAccessibility(koluxPage, agent!.tabId)).not.toContainText(
    'Conversation interrupted'
  )

  await activateTerminal(koluxPage, worktreeId, setup!.tabId)
  const mountedSetupPtyId = await waitForActivePanePtyId(koluxPage)
  await enableTerminalAccessibility(koluxPage, setup!.tabId)
  expect(mountedSetupPtyId).toBe(setup!.ptyId)
  await expect(terminalAccessibility(koluxPage, setup!.tabId)).toContainText(
    `SETUP_READY:${setupPid}`
  )
  const setupMarker = `SETUP_KB_${randomUUID().slice(0, 8)}`
  await clearTerminalPtyWriteLog(electronApp)
  await typeIntoTerminal(koluxPage, setup!.tabId, setupMarker)
  await assertExactPtyReceivedMarker(electronApp, setup!.ptyId, setupMarker)
  await expect(terminalAccessibility(koluxPage, setup!.tabId)).toContainText(
    `SETUP_INPUT:${setupPid}:${setupMarker}`
  )
  await expect(terminalAccessibility(koluxPage, setup!.tabId)).not.toContainText(
    'Conversation interrupted'
  )

  const canaryMarker = `CANARY_DIRECT_${randomUUID()}`
  await client.call('terminal.send', {
    terminal: canary!.handle,
    text: canaryMarker,
    enter: true
  })
  await expect
    .poll(() => terminalOutput(client, canary!.handle))
    .toContain(`CANARY_INPUT:${canaryPid}:${canaryMarker}`)

  await assertLiveInventory(client, worktreeId, originals)
  await assertTargetBindings(koluxPage, worktreeId, allIdentities)
  await assertLaunchLedgersUnchanged()
  await assertNoInterruption(client, [agent!, setup!])
  expect(readJsonLines(signalLedgerPath)).toHaveLength(0)
  const afterMountStatus = await client.call<RuntimeStatus>('status.get')
  expect(afterMountStatus.result).toMatchObject({
    runtimeId: beforeStatus.result.runtimeId,
    rendererGraphEpoch: beforeStatus.result.rendererGraphEpoch,
    graphStatus: 'ready',
    authoritativeWindowId: beforeStatus.result.authoritativeWindowId
  })
  expect(readDaemonPid(userDataDir)).toBe(daemonPid)
  const beforeReloadDelivery = await koluxPage.evaluate(() =>
    window.api.pty.getRendererDeliveryDebugSnapshot()
  )

  await koluxPage.reload()
  await waitForSessionReady(koluxPage)
  await expect
    .poll(
      async () => {
        const status = (await client.call<RuntimeStatus>('status.get')).result
        return {
          runtimeId: status.runtimeId,
          rendererGraphEpoch: status.rendererGraphEpoch,
          graphStatus: status.graphStatus,
          authoritativeWindowId: status.authoritativeWindowId,
          daemonPid: readDaemonPid(userDataDir)
        }
      },
      { timeout: 15_000 }
    )
    .toEqual({
      runtimeId: beforeStatus.result.runtimeId,
      rendererGraphEpoch: afterMountStatus.result.rendererGraphEpoch + 1,
      graphStatus: 'ready',
      authoritativeWindowId: beforeStatus.result.authoritativeWindowId,
      daemonPid
    })
  const postReloadDelivery = {
    rendererLifecycleResetCount: beforeReloadDelivery.rendererLifecycleResetCount + 1,
    rendererPtyDispatcherReady: true,
    rendererDispatcherReadyForcedCount: beforeReloadDelivery.rendererDispatcherReadyForcedCount
  }
  await expect
    .poll(() => koluxPage.evaluate(() => window.api.pty.getRendererDeliveryDebugSnapshot()))
    .toMatchObject(postReloadDelivery)
  await activateTerminal(koluxPage, worktreeId, agent!.tabId)
  const remountedAgentPtyId = await waitForActivePanePtyId(koluxPage)
  expect(remountedAgentPtyId).toBe(agent!.ptyId)
  await enableTerminalAccessibility(koluxPage, agent!.tabId)
  await expect
    .poll(() => koluxPage.evaluate(() => window.api.pty.getRendererDeliveryDebugSnapshot()))
    .toMatchObject(postReloadDelivery)
  const remountAgentLiveMarker = `AGENT_LIVE_${randomUUID()}`
  await client.call('terminal.send', {
    terminal: agent!.handle,
    text: remountAgentLiveMarker,
    enter: true
  })
  const remountAgentLiveOutput = `AGENT_INPUT:${agentPid}:${remountAgentLiveMarker}`
  await expect.poll(() => terminalOutput(client, agent!.handle)).toContain(remountAgentLiveOutput)
  await expect
    .poll(() => terminalViewportText(koluxPage, agent!.tabId))
    .toContain(remountAgentLiveOutput)
  expect(
    await koluxPage.evaluate(() => window.api.pty.getRendererDeliveryDebugSnapshot())
  ).toMatchObject(postReloadDelivery)
  const remountAgentAcceptedMarker = `AGENT_ACCEPTED_${randomUUID()}`
  expect(
    await koluxPage.evaluate(
      ({ marker, ptyId }) => window.api.pty.writeAccepted(ptyId, `${marker}\r`),
      { marker: remountAgentAcceptedMarker, ptyId: agent!.ptyId }
    )
  ).toBe(true)
  const remountAgentAcceptedOutput = `AGENT_INPUT:${agentPid}:${remountAgentAcceptedMarker}`
  await expect
    .poll(() => terminalOutput(client, agent!.handle))
    .toContain(remountAgentAcceptedOutput)
  await expect
    .poll(() => terminalViewportText(koluxPage, agent!.tabId))
    .toContain(remountAgentAcceptedOutput)
  const remountAgentMarker = `AGENT_REMOUNT_${randomUUID().slice(0, 8)}`
  await clearTerminalPtyWriteLog(electronApp)
  await typeIntoTerminal(koluxPage, agent!.tabId, remountAgentMarker)
  await assertExactPtyReceivedMarker(electronApp, agent!.ptyId, remountAgentMarker)
  const remountAgentOutput = `AGENT_INPUT:${agentPid}:${remountAgentMarker}`
  await expect.poll(() => terminalOutput(client, agent!.handle)).toContain(remountAgentOutput)
  await expect
    .poll(() => terminalViewportText(koluxPage, agent!.tabId))
    .toContain(remountAgentOutput)
  await activateTerminal(koluxPage, worktreeId, setup!.tabId)
  const remountedSetupPtyId = await waitForActivePanePtyId(koluxPage)
  expect(remountedSetupPtyId).toBe(setup!.ptyId)
  await enableTerminalAccessibility(koluxPage, setup!.tabId)
  const remountSetupLiveMarker = `SETUP_LIVE_${randomUUID()}`
  await client.call('terminal.send', {
    terminal: setup!.handle,
    text: remountSetupLiveMarker,
    enter: true
  })
  const remountSetupLiveOutput = `SETUP_INPUT:${setupPid}:${remountSetupLiveMarker}`
  await expect.poll(() => terminalOutput(client, setup!.handle)).toContain(remountSetupLiveOutput)
  await expect
    .poll(() => terminalViewportText(koluxPage, setup!.tabId))
    .toContain(remountSetupLiveOutput)
  expect(
    await koluxPage.evaluate(() => window.api.pty.getRendererDeliveryDebugSnapshot())
  ).toMatchObject(postReloadDelivery)
  const remountSetupMarker = `SETUP_REMOUNT_${randomUUID().slice(0, 8)}`
  await clearTerminalPtyWriteLog(electronApp)
  await typeIntoTerminal(koluxPage, setup!.tabId, remountSetupMarker)
  await assertExactPtyReceivedMarker(electronApp, setup!.ptyId, remountSetupMarker)
  const remountSetupOutput = `SETUP_INPUT:${setupPid}:${remountSetupMarker}`
  await expect.poll(() => terminalOutput(client, setup!.handle)).toContain(remountSetupOutput)
  await expect
    .poll(() => terminalViewportText(koluxPage, setup!.tabId))
    .toContain(remountSetupOutput)

  const remountCanaryMarker = `CANARY_REMOUNT_${randomUUID()}`
  await client.call('terminal.send', {
    terminal: canary!.handle,
    text: remountCanaryMarker,
    enter: true
  })
  await expect
    .poll(() => terminalOutput(client, canary!.handle))
    .toContain(`CANARY_INPUT:${canaryPid}:${remountCanaryMarker}`)
  await assertLiveInventory(client, worktreeId, originals)
  await assertTargetBindings(koluxPage, worktreeId, allIdentities)
  await assertLaunchLedgersUnchanged()
  await assertNoInterruption(client, [agent!, setup!])
  expect(readJsonLines(signalLedgerPath)).toHaveLength(0)
})
