import { is } from '@electron-toolkit/utils'

/** The runtime WS port pinned for E2E and dev launches; undefined keeps the default port. */
export function resolveRuntimeRpcWsPortPin(): { isE2E: boolean; wsPort: number | undefined } {
  // Why: parallel E2E Electron instances would race the fixed port (EADDRINUSE); port 0 gives each a random OS-assigned port.
  const isE2E = Boolean(process.env.KOLUX_E2E_USER_DATA_DIR)
  if (isE2E) {
    const requested = process.env.KOLUX_E2E_RUNTIME_WS_PORT
    const wsPort = requested === undefined ? 0 : Number(requested)
    if (!Number.isInteger(wsPort) || wsPort < 0 || wsPort > 65_535) {
      throw new Error(`Invalid KOLUX_E2E_RUNTIME_WS_PORT value: ${requested}`)
    }
    return { isE2E, wsPort }
  }
  // Why: pin dev to 6769 so `pnpm dev` doesn't race packaged Kolux on 6768 and fall back to a random port, breaking deterministic mobile pairing/repro (STA-1511).
  return { isE2E, wsPort: is.dev ? 6769 : undefined }
}
