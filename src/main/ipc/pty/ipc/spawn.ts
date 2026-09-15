import type { IpcMainInvokeEvent } from 'electron'
import { getPtyIpc } from '../../pty-host-bindings'
import { runPtyIpcSpawn } from './spawn-run'
import { sessionKeyForWebContents, setPtyWindowOwner } from '../pty-window-ownership'
import type { PtySpawnIpcArgs, PtySpawnIpcDeps } from './spawn-types'

export function installPtySpawnIpcHandler(deps: PtySpawnIpcDeps): void {
  const ipcMain = getPtyIpc()
  const { getLocalPtyStartupPromise } = deps

  ipcMain.handle('pty:spawn', async (event: IpcMainInvokeEvent, args: PtySpawnIpcArgs) => {
    const startupPromise = getLocalPtyStartupPromise(args.connectionId)
    if (startupPromise) {
      await startupPromise
    }
    const result = await runPtyIpcSpawn(deps, args)
    // Why here, not at the pty:write boundary: a terminal window owns the pty it
    // spawned for the lifetime of the pty, not just the request that created it.
    const spawnedId = (result as { id?: unknown } | null)?.id
    if (typeof spawnedId === 'string') {
      const sessionKey = sessionKeyForWebContents(event.sender)
      if (sessionKey) {
        setPtyWindowOwner(spawnedId, sessionKey)
      }
    }
    return result
  })
}
