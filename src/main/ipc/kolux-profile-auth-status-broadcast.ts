import { BrowserWindow } from 'electron'
import { KOLUX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL } from '../../shared/kolux-profiles'

export function broadcastKoluxProfileAuthStatusChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send(KOLUX_PROFILE_AUTH_STATUS_CHANGED_CHANNEL)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}
