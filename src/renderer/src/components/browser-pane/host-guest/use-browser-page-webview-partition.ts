import { useAppStore } from '@/store'
import { KOLUX_BROWSER_PARTITION } from '../../../../../shared/constants'
import { getKoluxProfileBrowserDefaultPartition } from '../../../../../shared/kolux-profiles'

export function useBrowserPageWebviewPartition({
  sessionProfileId,
  sessionPartition
}: {
  sessionProfileId: string | null
  sessionPartition: string | null
}): string {
  const browserSessionProfiles = useAppStore((s) => s.browserSessionProfiles)
  const activeKoluxProfileId = useAppStore((s) => s.activeKoluxProfileId)
  const fallbackBrowserPartition = activeKoluxProfileId
    ? getKoluxProfileBrowserDefaultPartition(activeKoluxProfileId)
    : null
  const defaultSessionProfile = browserSessionProfiles.find((p) => p.id === 'default') ?? null
  const sessionProfile = sessionProfileId
    ? (browserSessionProfiles.find((p) => p.id === sessionProfileId) ?? null)
    : defaultSessionProfile
  return (
    sessionPartition ??
    sessionProfile?.partition ??
    defaultSessionProfile?.partition ??
    fallbackBrowserPartition ??
    KOLUX_BROWSER_PARTITION
  )
}
