import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { writePressureOutputScript } from './artificial-tui-hidden-pressure-script'
import {
  ensureTerminalVisible,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { waitForTerminalPtyVisible } from './artificial-tui-pane-interactions'
import {
  expectPressureStayedBounded,
  startRealPtyPressureCommands,
  waitForMarkerLatency
} from './artificial-tui-revisit-pressure-helpers'

export type RevisitPressurePane = { paneKey: string; ptyId: string }

export type RevisitPressureMeasurement = {
  medianLatencyMs: number
  worstLatencyMs: number
  maxTimerDriftMs: number
}

type RevisitPressureDebug = { hiddenRendererSkipCount: number }

export type RevisitPressureSchedulerSnapshot = {
  peakQueuedChars: number
  droppedBacklogCount: number
}

export type RevisitPressureMainSnapshot = {
  peakPendingChars: number
  peakRendererInFlightChars: number
  ackGatedFlushSkipCount: number
}

export type RevisitPressureAckGate = { heldAckChars: number }

type RevisitPressureDeps<
  TMeasurement extends RevisitPressureMeasurement,
  TDebug extends RevisitPressureDebug,
  TScheduler extends RevisitPressureSchedulerSnapshot,
  TMainPressure extends RevisitPressureMainSnapshot,
  TAckGate extends RevisitPressureAckGate
> = {
  annotateTypingMeasurement: (
    testInfo: TestInfo,
    type: string,
    paneCount: number,
    measurement: TMeasurement,
    debug: TDebug | null,
    scheduler: TScheduler | null,
    mainPressure: TMainPressure | null,
    ackGate: TAckGate | null
  ) => void
  ensureActiveWorktreePaneLoad: (page: Page, paneCount: number) => Promise<RevisitPressurePane[]>
  focusPane: (page: Page, paneKey: string) => Promise<void>
  holdTerminalAckGate: (page: Page, ptyIds: string[]) => Promise<void>
  measureTypingDuringLoad: (
    page: Page,
    scriptPath: string,
    ptyId: string,
    runId: string
  ) => Promise<TMeasurement>
  readMainPtyPressureDebug: (page: Page) => Promise<TMainPressure | null>
  readTerminalAckGateDebug: (page: Page) => Promise<TAckGate | null>
  readTerminalOutputSchedulerDebug: (page: Page) => Promise<TScheduler | null>
  readTerminalPtyOutputDebug: (page: Page) => Promise<TDebug | null>
  releaseTerminalAckGate: (page: Page) => Promise<void>
  resetTerminalPtyOutputDebug: (page: Page) => Promise<void>
  waitForMainPtyPressureBacklog: (page: Page) => Promise<TMainPressure>
  writeInteractivePromptScript: (scriptPath: string, runId: string) => void
}

export async function runRendererBackpressureRevisitScenario<
  TMeasurement extends RevisitPressureMeasurement,
  TDebug extends RevisitPressureDebug,
  TScheduler extends RevisitPressureSchedulerSnapshot,
  TMainPressure extends RevisitPressureMainSnapshot,
  TAckGate extends RevisitPressureAckGate
>({
  backgroundPaneCount,
  deps,
  maxMedianKeyLatencyMs,
  maxRendererSchedulerQueuedChars,
  maxRevisitLatencyMs,
  maxTimerDriftMs,
  maxWorstKeyLatencyMs,
  mainRendererPressureTargetChars,
  pressureOutputChars,
  koluxPage,
  testInfo,
  testRepoPath
}: {
  backgroundPaneCount: number
  deps: RevisitPressureDeps<TMeasurement, TDebug, TScheduler, TMainPressure, TAckGate>
  maxMedianKeyLatencyMs: number
  maxRendererSchedulerQueuedChars: number
  maxRevisitLatencyMs: number
  maxTimerDriftMs: number
  maxWorstKeyLatencyMs: number
  mainRendererPressureTargetChars: number
  pressureOutputChars: number
  koluxPage: Page
  testInfo: TestInfo
  testRepoPath: string
}): Promise<void> {
  await waitForSessionReady(koluxPage)
  const firstWorktreeId = await waitForActiveWorktree(koluxPage)
  const secondWorktreeId = (await getAllWorktreeIds(koluxPage)).find((id) => id !== firstWorktreeId)
  expect(Boolean(secondWorktreeId), 'renderer backpressure revisit needs a second worktree').toBe(
    true
  )
  if (!secondWorktreeId) {
    return
  }

  const runId = randomUUID()
  const typingPtyReadyMarker = `TUI_REVISIT_TYPING_PTY_READY_${runId}`
  await switchToWorktree(koluxPage, secondWorktreeId)
  await ensureTerminalVisible(koluxPage)
  await waitForActiveTerminalManager(koluxPage, 30_000)
  const typingPtyId = await waitForActivePanePtyId(koluxPage)
  await sendToTerminal(koluxPage, typingPtyId, `printf '\\n${typingPtyReadyMarker}\\n'\r`)
  await waitForMarkerLatency(koluxPage, typingPtyReadyMarker, 10_000)

  await switchToWorktree(koluxPage, firstWorktreeId)
  await ensureTerminalVisible(koluxPage)
  await waitForActiveTerminalManager(koluxPage, 30_000)
  const panes = await deps.ensureActiveWorktreePaneLoad(koluxPage, backgroundPaneCount + 1)
  const [revisitPane, ...loadPanes] = panes
  await deps.focusPane(koluxPage, revisitPane.paneKey)

  const typingScriptPath = path.join(testRepoPath, `.kolux-revisit-typing-${runId}.mjs`)
  const pressureScriptPath = path.join(testRepoPath, `.kolux-revisit-pressure-${runId}.mjs`)
  const revisitMarker = `TUI_REVISIT_READY_${runId}`
  const pressureDoneMarker = `TUI_PRESSURE_DONE_${runId}_0`
  deps.writeInteractivePromptScript(typingScriptPath, runId)
  writePressureOutputScript(pressureScriptPath, runId, 'tui')
  await deps.resetTerminalPtyOutputDebug(koluxPage)
  await deps.holdTerminalAckGate(
    koluxPage,
    loadPanes.map((pane) => pane.ptyId)
  )
  try {
    await startRealPtyPressureCommands({
      loadPanes,
      koluxPage,
      pressureOutputChars,
      pressureScriptPath
    })
    const pressureBeforeSwitch = await deps.waitForMainPtyPressureBacklog(koluxPage)

    await switchToWorktree(koluxPage, secondWorktreeId)
    await ensureTerminalVisible(koluxPage)
    await waitForActiveTerminalManager(koluxPage, 30_000)
    await waitForTerminalPtyVisible(koluxPage, typingPtyId)
    const measurement = await deps.measureTypingDuringLoad(
      koluxPage,
      typingScriptPath,
      typingPtyId,
      runId
    )
    const duringPressure = await deps.readMainPtyPressureDebug(koluxPage)
    const ackGate = await deps.readTerminalAckGateDebug(koluxPage)
    const scheduler = await deps.readTerminalOutputSchedulerDebug(koluxPage)
    const hiddenDebug = await deps.readTerminalPtyOutputDebug(koluxPage)
    deps.annotateTypingMeasurement(
      testInfo,
      'tui-main-pressure-worktree-revisit-typing',
      panes.length + 1,
      measurement,
      hiddenDebug,
      scheduler,
      duringPressure,
      ackGate
    )

    expectPressureStayedBounded({
      ackGate,
      mainRendererPressureTargetChars,
      maxMedianKeyLatencyMs,
      maxRendererSchedulerQueuedChars,
      maxTimerDriftMs,
      maxWorstKeyLatencyMs,
      measurement,
      pressureBeforeSwitch,
      scheduler,
      duringPressure
    })

    await switchToWorktree(koluxPage, firstWorktreeId)
    await ensureTerminalVisible(koluxPage)
    await waitForActiveTerminalManager(koluxPage, 30_000)
    // Why: hidden PaneManagers persist, so manager readiness alone can race the reveal commit.
    await waitForTerminalPtyVisible(koluxPage, revisitPane.ptyId)
    await deps.focusPane(koluxPage, revisitPane.paneKey)
    await sendToTerminal(koluxPage, revisitPane.ptyId, `printf '\\n${revisitMarker}\\n'\r`)
    const revisitLatencyMs = await waitForMarkerLatency(koluxPage, revisitMarker, 10_000)
    testInfo.annotations.push({
      type: 'tui-main-pressure-worktree-revisit-marker',
      description: `panes=${panes.length + 1} revisit=${revisitLatencyMs.toFixed(
        1
      )}ms heldAckChars=${ackGate?.heldAckChars ?? 0}`
    })
    // Why: this printf is measured after a worktree switch/focus while the
    // background panes are still ACK-gate-held, so it gets its own under-load
    // bound rather than the unloaded worst-key budget.
    expect(revisitLatencyMs).toBeLessThan(maxRevisitLatencyMs)

    await deps.releaseTerminalAckGate(koluxPage)
    await deps.focusPane(koluxPage, loadPanes[0]?.paneKey ?? revisitPane.paneKey)
    const pressureDrainLatencyMs = await waitForMarkerLatency(koluxPage, pressureDoneMarker, 20_000)
    const finalScheduler = await deps.readTerminalOutputSchedulerDebug(koluxPage)
    testInfo.annotations.push({
      type: 'tui-main-pressure-worktree-revisit-drain',
      description: `panes=${panes.length + 1} drain=${pressureDrainLatencyMs.toFixed(
        1
      )}ms rendererPeakQueuedChars=${finalScheduler?.peakQueuedChars ?? 0} rendererDroppedBacklogs=${
        finalScheduler?.droppedBacklogCount ?? 0
      }`
    })
    expect(finalScheduler?.droppedBacklogCount ?? Number.POSITIVE_INFINITY).toBe(0)
    expect(finalScheduler?.peakQueuedChars ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      maxRendererSchedulerQueuedChars
    )
  } finally {
    await deps.releaseTerminalAckGate(koluxPage)
    await sendToTerminal(koluxPage, typingPtyId, '\x03').catch(() => undefined)
    await sendToTerminal(koluxPage, revisitPane.ptyId, '\x03').catch(() => undefined)
    await Promise.all(
      loadPanes.map((pane) => sendToTerminal(koluxPage, pane.ptyId, '\x03').catch(() => undefined))
    )
    rmSync(typingScriptPath, { force: true })
    rmSync(pressureScriptPath, { force: true })
  }
}
