import type { TestInfo } from '@stablyai/playwright-test'
import { test, expect } from './helpers/kolux-app'
import {
  ensureTerminalVisible,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import {
  cleanupDockerSshRelayTarget,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import {
  REMOTE_CODEX_FIXTURE_CLEAN_FINAL_TEXT,
  REMOTE_TUI_DONE,
  installRemoteCodexArtifactTui,
  installRemoteCodexFixture,
  shellQuote
} from './ssh-codex-repro-remote-fixtures'
import {
  connectDockerRemote,
  dropDockerSshClientSessions,
  enableRiskyTerminalRendererPath,
  installPtyReplayProbe,
  readDuplicateStatusRows,
  readReplayProbeSnapshot,
  switchToNonRemoteWorktree,
  waitForDockerRemoteReconnected
} from './ssh-codex-reconnect-replay-driver'
import { installRemoteRealCodex, realRemoteCodexCommand } from './ssh-codex-real-remote'
import {
  clearRemoteTerminalAfterCodex,
  scrollActiveTerminalToArtifactHistory,
  stressRestoreRemoteTerminalDuringCodex,
  waitForRealRemoteCodexCompletion,
  waitForRemoteFixtureCleanFinalInHiddenPane
} from './ssh-codex-terminal-observers'
import { MAX_FINAL_GRAY_SLABS, captureGraySlabAnalysis } from './terminal-raster-artifact-analysis'
import { persistReproEvidence } from './terminal-repro-evidence'
import { resetWebglAndCaptureGraySlabAnalysis } from './terminal-webgl-reset-capture'

const RUN_DOCKER_SSH = process.env.KOLUX_E2E_SSH_DOCKER === '1'
const RUN_REAL_REMOTE_CODEX = process.env.KOLUX_E2E_REAL_REMOTE_CODEX === '1'
const EXPECT_NO_ARTIFACTS = process.env.KOLUX_E2E_EXPECT_NO_CODEX_ARTIFACTS !== '0'
const CAPTURE_WHILE_REMOTE_TUI_RUNNING =
  process.env.KOLUX_E2E_CAPTURE_WHILE_REMOTE_TUI_RUNNING === '1'
const HIDE_UNTIL_REMOTE_TUI_DONE = process.env.KOLUX_E2E_HIDE_UNTIL_REMOTE_TUI_DONE === '1'
const CAPTURE_SCROLLBACK_ARTIFACT_REGION =
  process.env.KOLUX_E2E_CAPTURE_SCROLLBACK_ARTIFACT_REGION === '1'
const reconnectOverride = process.env.KOLUX_E2E_FORCE_SSH_RECONNECT_DURING_TUI
const reconnectModes = reconnectOverride === undefined ? [false, true] : [reconnectOverride === '1']
const KEEP_SSH_REPRO_TARGET = process.env.KOLUX_E2E_KEEP_SSH_REPRO_TARGET === '1'

test.describe('Remote SSH Codex display artifacts repro', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set KOLUX_E2E_SSH_DOCKER=1 to run Docker-backed SSH repro.')
  test.skip(process.platform === 'win32', 'Docker SSH repro uses POSIX ssh tooling.')

  for (const forceReconnect of reconnectModes) {
    test(`does not leave duplicated Codex status output after SSH replay (${forceReconnect ? 'forced reconnect' : 'normal restore'})`, async ({
      koluxPage,
      electronApp
    }, testInfo: TestInfo) => {
      test.slow()
      let target: DockerSshRelayTarget | null = null
      try {
        target = startDockerSshRelayTarget(testInfo)
        installRemoteCodexArtifactTui(target)
        if (RUN_REAL_REMOTE_CODEX) {
          installRemoteRealCodex(target)
        } else {
          installRemoteCodexFixture(target)
        }
        await waitForSessionReady(koluxPage)
        await waitForActiveWorktree(koluxPage)
        const remote = await connectDockerRemote(koluxPage, target)
        expect(remote.targetId).toBeTruthy()
        expect(remote.worktreeId).toBeTruthy()
        await ensureTerminalVisible(koluxPage, 45_000)
        await waitForActiveTerminalManager(koluxPage, 60_000)
        await enableRiskyTerminalRendererPath(koluxPage)

        const ptyId = await waitForActivePanePtyId(koluxPage, 60_000)
        await installPtyReplayProbe(koluxPage, electronApp, ptyId)
        const doneMarker = RUN_REAL_REMOTE_CODEX
          ? `KOLUX_REAL_REMOTE_CODEX_DONE_${Date.now()}`
          : REMOTE_TUI_DONE
        const cleanMarker = RUN_REAL_REMOTE_CODEX
          ? `KOLUX_REAL_REMOTE_CODEX_CLEAN_${Date.now()}`
          : doneMarker
        await execInTerminal(
          koluxPage,
          ptyId,
          RUN_REAL_REMOTE_CODEX
            ? realRemoteCodexCommand(doneMarker)
            : `codex --no-alt-screen --dangerously-bypass-approvals-and-sandbox ${shellQuote(
                doneMarker
              )}`
        )
        await koluxPage.waitForTimeout(1_200)
        if (forceReconnect) {
          dropDockerSshClientSessions(target)
          await waitForDockerRemoteReconnected(koluxPage, remote.targetId)
          await koluxPage.waitForTimeout(2_000)
        }
        await (RUN_REAL_REMOTE_CODEX
          ? (async () => {
              await stressRestoreRemoteTerminalDuringCodex(koluxPage, remote.worktreeId)
              await waitForRealRemoteCodexCompletion(koluxPage, doneMarker)
            })()
          : (async () => {
              if (CAPTURE_WHILE_REMOTE_TUI_RUNNING) {
                await koluxPage.waitForTimeout(10_000)
              } else {
                await switchToNonRemoteWorktree(koluxPage, remote.worktreeId)
                await (HIDE_UNTIL_REMOTE_TUI_DONE
                  ? waitForRemoteFixtureCleanFinalInHiddenPane(koluxPage, remote.worktreeId)
                  : koluxPage.waitForTimeout(10_000))
              }
              if (CAPTURE_WHILE_REMOTE_TUI_RUNNING) {
                await koluxPage.waitForTimeout(900)
                return
              }
              await switchToWorktree(koluxPage, remote.worktreeId)
              await ensureTerminalVisible(koluxPage, 45_000)
              await waitForActiveTerminalManager(koluxPage, 60_000)
              await waitForTerminalOutput(
                koluxPage,
                REMOTE_CODEX_FIXTURE_CLEAN_FINAL_TEXT,
                60_000,
                120_000
              )
            })())
        await koluxPage.waitForTimeout(600)
        if (CAPTURE_SCROLLBACK_ARTIFACT_REGION) {
          await scrollActiveTerminalToArtifactHistory(koluxPage)
        }

        const { analysis, screenshot } = await captureGraySlabAnalysis(koluxPage)
        analysis.replayDebug = await readReplayProbeSnapshot(koluxPage, electronApp)
        analysis.duplicateStatusRows = await readDuplicateStatusRows(koluxPage)
        const evidenceLabel = RUN_REAL_REMOTE_CODEX
          ? 'real-remote-codex-reconnect-replay'
          : 'fixture-codex-reconnect-replay'
        persistReproEvidence(evidenceLabel, analysis, screenshot)
        const resetEvidence = await resetWebglAndCaptureGraySlabAnalysis(koluxPage)
        resetEvidence.analysis.replayDebug = await readReplayProbeSnapshot(koluxPage, electronApp)
        resetEvidence.analysis.duplicateStatusRows = await readDuplicateStatusRows(koluxPage)
        persistReproEvidence(
          `${evidenceLabel}-after-webgl-reset`,
          resetEvidence.analysis,
          resetEvidence.screenshot
        )
        await testInfo.attach('remote-codex-artifact-final-screen', {
          body: screenshot,
          contentType: 'image/png'
        })
        await testInfo.attach('remote-codex-artifact-after-webgl-reset', {
          body: resetEvidence.screenshot,
          contentType: 'image/png'
        })
        testInfo.annotations.push({
          type: 'remote-codex-artifact-analysis',
          description: JSON.stringify(analysis)
        })
        testInfo.annotations.push({
          type: 'remote-codex-artifact-after-webgl-reset-analysis',
          description: JSON.stringify(resetEvidence.analysis)
        })

        // Why: this spec supports both repro mode and strict regression mode so
        // the same harness can prove a failure and lock the fixed behavior.
        if (EXPECT_NO_ARTIFACTS) {
          expect(analysis.slabCount).toBeLessThanOrEqual(MAX_FINAL_GRAY_SLABS)
          expect(analysis.staleStatusGlyphRowCount).toBe(0)
          expect(analysis.duplicateStatusRows ?? []).toEqual([])
        } else {
          expect(analysis.rawSlabCount + analysis.staleStatusGlyphRowCount).toBeGreaterThan(0)
        }
        if (forceReconnect) {
          expect(await waitForActivePanePtyId(koluxPage, 60_000)).toBe(ptyId)
          expect(Number(analysis.replayDebug?.replayCount ?? 0)).toBeGreaterThan(0)
        }
        if (RUN_REAL_REMOTE_CODEX) {
          await clearRemoteTerminalAfterCodex(koluxPage, ptyId, cleanMarker)
        }
      } finally {
        if (KEEP_SSH_REPRO_TARGET && target) {
          console.log(
            `[ssh-codex-repro] keeping Docker SSH target ${target.containerName} on port ${target.port}`
          )
        } else {
          cleanupDockerSshRelayTarget(target)
        }
      }
    })
  }
})
