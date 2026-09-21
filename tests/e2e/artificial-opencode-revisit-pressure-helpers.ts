import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { getTerminalContent, sendToTerminal } from './helpers/terminal'
import type {
  RevisitPressureAckGate,
  RevisitPressureMainSnapshot,
  RevisitPressureMeasurement,
  RevisitPressurePane,
  RevisitPressureSchedulerSnapshot
} from './artificial-opencode-revisit-pressure-scenario'

export async function startRealPtyPressureCommands({
  loadPanes,
  koluxPage,
  pressureOutputChars,
  pressureScriptPath
}: {
  loadPanes: RevisitPressurePane[]
  koluxPage: Page
  pressureOutputChars: number
  pressureScriptPath: string
}): Promise<void> {
  await Promise.all(
    loadPanes.map((pane, paneIndex) =>
      sendToTerminal(
        koluxPage,
        pane.ptyId,
        `node ${JSON.stringify(pressureScriptPath)} ${paneIndex} ${pressureOutputChars}\r`
      )
    )
  )
}

export async function waitForMarkerLatency(
  page: Page,
  marker: string,
  timeoutMs: number
): Promise<number> {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if ((await getTerminalContent(page, 12_000)).includes(marker)) {
      return performance.now() - start
    }
    await page.waitForTimeout(5)
  }
  throw new Error(`Timed out waiting for terminal marker ${marker}`)
}

export function expectPressureStayedBounded<TMeasurement extends RevisitPressureMeasurement>({
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
}: {
  ackGate: RevisitPressureAckGate | null
  mainRendererPressureTargetChars: number
  maxMedianKeyLatencyMs: number
  maxRendererSchedulerQueuedChars: number
  maxTimerDriftMs: number
  maxWorstKeyLatencyMs: number
  measurement: TMeasurement
  pressureBeforeSwitch: RevisitPressureMainSnapshot
  scheduler: RevisitPressureSchedulerSnapshot | null
  duringPressure: RevisitPressureMainSnapshot | null
}): void {
  expect(pressureBeforeSwitch.peakPendingChars).toBeGreaterThan(0)
  expect(pressureBeforeSwitch.ackGatedFlushSkipCount).toBeGreaterThan(0)
  expect(duringPressure?.peakRendererInFlightChars ?? 0).toBeGreaterThanOrEqual(
    mainRendererPressureTargetChars
  )
  expect(ackGate?.heldAckChars ?? 0).toBeGreaterThan(0)
  expect(scheduler?.droppedBacklogCount ?? Number.POSITIVE_INFINITY).toBe(0)
  expect(scheduler?.peakQueuedChars ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
    maxRendererSchedulerQueuedChars
  )
  expect(measurement.medianLatencyMs).toBeLessThan(maxMedianKeyLatencyMs)
  expect(measurement.worstLatencyMs).toBeLessThan(maxWorstKeyLatencyMs)
  expect(measurement.maxTimerDriftMs).toBeLessThan(maxTimerDriftMs)
}
