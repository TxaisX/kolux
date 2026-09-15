import type { BrowserWindow } from 'electron'
import type { AgentSessionPtyWriteRefusal } from '../../../shared/agent-session-pty-write-admission'
import { resolvePtyDeliveryWindow } from './pty-window-ownership'

// Why: a lease refusal is never a silent drop — it rides the existing write-unavailable channel
// with an additive field, so old renderers keep their current behavior and new ones can name the
// owner. See docs/reference/remote-wire-compatibility.md.
export function reportAgentSessionWriteRefusal(
  mainWindow: BrowserWindow,
  id: string,
  refusal: AgentSessionPtyWriteRefusal
): void {
  const target = resolvePtyDeliveryWindow(id, mainWindow)
  if (
    target.isDestroyed() ||
    (typeof target.webContents.isDestroyed === 'function' && target.webContents.isDestroyed())
  ) {
    return
  }
  target.webContents.send('pty:writeUnavailable', { id, agentSessionRefusal: refusal })
}
