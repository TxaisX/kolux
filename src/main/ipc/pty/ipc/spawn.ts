import type { IpcMainInvokeEvent } from 'electron'
import { getPtyIpc } from '../../pty-host-bindings'
import { runPtyIpcSpawn } from './spawn-run'
import { sessionKeyForWebContents, setPtyWindowOwner } from '../pty-window-ownership'
import type { PtySpawnIpcArgs, PtySpawnIpcDeps } from './spawn-types'

export function installPtySpawnIpcHandler(deps: PtySpawnIpcDeps): void {
  const ipcMain = getPtyIpc()
  const { getLocalPtyStartupPromise } = deps

  // Why the nullable event: the suite drives this handler directly with a null event
  // (pty-ipc-spawn-drivers.ts and friends), and window ownership below is best-effort,
  // so a missing sender records no owner rather than throwing the spawn away.
  ipcMain.handle('pty:spawn', async (event: IpcMainInvokeEvent | null, args: PtySpawnIpcArgs) => {
    const startupPromise = getLocalPtyStartupPromise(args.connectionId)
    if (startupPromise) {
      await startupPromise
    }
    const result = await runPtyIpcSpawn(deps, args)
    // Why here, not at the pty:write boundary: a terminal window owns the pty it
    // spawned for the lifetime of the pty, not just the request that created it.
    const spawnedId = (result as { id?: unknown } | null)?.id
    if (typeof spawnedId === 'string') {
      const sender = event?.sender
      const sessionKey = sender ? sessionKeyForWebContents(sender) : null
      if (sessionKey) {
        setPtyWindowOwner(spawnedId, sessionKey)
      }
    }
    return result
  })
}
