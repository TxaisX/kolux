import type { UpdateStatus } from '../../../../shared/update-status-types'
import { toast } from 'sonner'
import { useAppStore } from '../../store'

const announcedVersions = new Set<string>()

function applyUpdateStatus(status: UpdateStatus): void {
  useAppStore.getState().setUpdateStatus(status)
  if (status.state === 'available' && !announcedVersions.has(status.version)) {
    announcedVersions.add(status.version)
    toast.info(`Kolux v${status.version} is available`, {
      description: 'Kolux will download it. Restart when the update is ready.'
    })
  }
}

export function registerUpdaterStatusIpcBridge(unsubs: (() => void)[]): void {
  let receivedPush = false
  unsubs.push(
    window.api.updater.onStatus((raw) => {
      receivedPush = true
      applyUpdateStatus(raw as UpdateStatus)
    })
  )
  void window.api.updater.getStatus().then((status) => {
    // Why: the initial snapshot may settle after a newer live event.
    if (!receivedPush) {
      applyUpdateStatus(status as UpdateStatus)
    }
  })
  unsubs.push(
    window.api.updater.onClearDismissal(() => {
      useAppStore.getState().clearDismissedUpdateVersion()
    })
  )
}
