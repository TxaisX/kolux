import type {
  PtyDeliveryWriteOff,
  PtyRendererDeliveryHealthReply,
  PtyRendererDeliveryStateReport
} from '../../../../shared/pty-renderer-delivery-health'
import { getPtyIpc } from '../../pty-host-bindings'
import { tryGetProviderForPty } from '../provider/registry'
import { PTY_DELIVERY_HEAL_MIN_ACK_SILENCE_MS } from '../delivery/constants'
import { applyCumulativeAck } from '../delivery/accounting'
import { isAuthorizedPtySender, ptySenderOrMain } from '../pty-window-ownership'
import type { PtyIpcSession } from '../session'

/** The ack/resync/health-report channels that credit renderer-bound delivery, split out of
 *  resize-visibility.ts so ownership validation didn't push that file over the line cap. */
export function installPtyDeliveryHealthIpc(session: PtyIpcSession): void {
  const ipcMain = getPtyIpc()
  const { mainWindow } = session

  // Why: renderer ACKs bound main→renderer delivery without stopping PTY ingestion — agent/status consumers still see every chunk via the provider/runtime path.
  ipcMain.removeAllListeners('pty:ackData')
  ipcMain.on(
    'pty:ackData',
    (event, args: { id: string; charCount?: number; processedChars?: number }) => {
      // Why first: an ack for a ptyId this sender doesn't own must not move that pty's
      // credit — window A naming window B's ptyId would otherwise release B's backpressure.
      if (!isAuthorizedPtySender(ptySenderOrMain(event, mainWindow), args.id, mainWindow)) {
        return
      }
      session.lastAckReceivedAtMs = Date.now()
      // Why: a live ACK channel means a future unanswered probe is a fresh diagnostic event, not a continuation of the last silent streak.
      session.deliveryResyncUnansweredWarnLogged = false
      let acknowledged = 0
      if (typeof args.processedChars === 'number' && Number.isFinite(args.processedChars)) {
        acknowledged = applyCumulativeAck(session, args.id, Math.max(0, args.processedChars))
      } else {
        // Why: tolerate legacy per-chunk delta payloads — dev hot-reload can pair an old renderer with a new main.
        const accounting = session.rendererDeliveryAccountingByPty.get(args.id)
        const delta = Number.isFinite(args.charCount) ? Math.max(0, args.charCount ?? 0) : 0
        acknowledged = accounting
          ? applyCumulativeAck(session, args.id, accounting.ackedChars + delta)
          : 0
      }
      tryGetProviderForPty(args.id)?.acknowledgeDataEvent(args.id, acknowledged)
      session.schedulePendingDataAfterCreditReport(acknowledged > 0)
    }
  )

  ipcMain.removeAllListeners('pty:deliveryResyncResponse')
  ipcMain.on(
    'pty:deliveryResyncResponse',
    (event, args: { requestId: number; processedCharsByPty: Record<string, number> }) => {
      if (
        ptySenderOrMain(event, mainWindow) !== mainWindow.webContents ||
        session.deliveryResyncOutstandingRequestId === null ||
        args?.requestId !== session.deliveryResyncOutstandingRequestId
      ) {
        return
      }
      session.clearDeliveryResyncProbe()
      session.deliveryResyncUnansweredWarnLogged = false
      // Why max-merge: the renderer's cumulative totals are authoritative for what it processed, draining exactly the in-flight debt from lost ACKs.
      let creditedAny = false
      for (const [id, processedChars] of Object.entries(args.processedCharsByPty ?? {})) {
        if (typeof processedChars !== 'number' || !Number.isFinite(processedChars)) {
          continue
        }
        const acknowledged = applyCumulativeAck(session, id, Math.max(0, processedChars))
        if (acknowledged > 0) {
          creditedAny = true
          tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
        }
      }
      session.schedulePendingDataAfterCreditReport(creditedAny)
    }
  )

  // Why invoke + renderer-initiated: the field wedge (v1.4.121-rc.0) kills every main→renderer push channel while invoke survives, so the resync rides here plus a write-off lane.
  ipcMain.removeHandler('pty:reportRendererDeliveryState')
  ipcMain.handle(
    'pty:reportRendererDeliveryState',
    (event, args: PtyRendererDeliveryStateReport): PtyRendererDeliveryHealthReply => {
      // Extra repair lane for the lost-ACK variant: identical max-merge to the resync response, so a heal is only reached when merging cannot drain.
      let creditedAny = false
      for (const [id, processedChars] of Object.entries(args?.processedCharsByPty ?? {})) {
        // Why per-id: a terminal window only ever legitimately reports its own pty(s).
        if (
          typeof processedChars !== 'number' ||
          !Number.isFinite(processedChars) ||
          !isAuthorizedPtySender(ptySenderOrMain(event, mainWindow), id, mainWindow)
        ) {
          continue
        }
        const acknowledged = applyCumulativeAck(session, id, Math.max(0, processedChars))
        if (acknowledged > 0) {
          creditedAny = true
          tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
        }
      }
      let writtenOff: PtyDeliveryWriteOff[] = []
      // Why the main-side ACK-silence check: requiring main to have also seen no ACK stops a buggy/foreign caller from writing off live delivery.
      if (
        args?.heal === true &&
        session.rendererInFlightTotalChars > 0 &&
        (session.lastAckReceivedAtMs === null ||
          Date.now() - session.lastAckReceivedAtMs >= PTY_DELIVERY_HEAL_MIN_ACK_SILENCE_MS)
      ) {
        writtenOff = session.writeOffLostRendererDelivery(args)
        creditedAny ||= writtenOff.length > 0
      }
      session.schedulePendingDataAfterCreditReport(creditedAny)
      let inFlightPtyCount = 0
      for (const accounting of session.rendererDeliveryAccountingByPty.values()) {
        if (accounting.sentChars - accounting.ackedChars > 0) {
          inFlightPtyCount++
        }
      }
      return {
        inFlightTotalChars: session.rendererInFlightTotalChars,
        inFlightPtyCount,
        msSinceLastAck:
          session.lastAckReceivedAtMs === null ? null : Date.now() - session.lastAckReceivedAtMs,
        ...(writtenOff.length > 0 ? { writtenOff } : {})
      }
    }
  )
}
