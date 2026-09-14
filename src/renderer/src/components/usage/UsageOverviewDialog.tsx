import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useAppStore } from '../../store'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog'
import { buildUsageOverviewModel } from './usage-overview-model'
import { UsageOverviewProviderCard } from './UsageOverviewProviderCard'
import { translate } from '@/i18n/i18n'

export function UsageOverviewDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const rateLimits = useAppStore((s) => s.rateLimits)
  const detectedAgentIds = useAppStore((s) => s.detectedAgentIds)
  const settings = useAppStore((s) => s.settings)
  const claudeUsageScanState = useAppStore((s) => s.claudeUsageScanState)
  const claudeUsageDaily = useAppStore((s) => s.claudeUsageDaily)
  const claudeUsageRecentSessions = useAppStore((s) => s.claudeUsageRecentSessions)
  const codexUsageScanState = useAppStore((s) => s.codexUsageScanState)
  const codexUsageDaily = useAppStore((s) => s.codexUsageDaily)
  const codexUsageRecentSessions = useAppStore((s) => s.codexUsageRecentSessions)
  const openCodeUsageScanState = useAppStore((s) => s.openCodeUsageScanState)
  const openCodeUsageDaily = useAppStore((s) => s.openCodeUsageDaily)
  const openCodeUsageRecentSessions = useAppStore((s) => s.openCodeUsageRecentSessions)
  const refreshRateLimits = useAppStore((s) => s.refreshRateLimits)
  const refreshDetectedAgents = useAppStore((s) => s.refreshDetectedAgents)
  const fetchClaudeUsage = useAppStore((s) => s.fetchClaudeUsage)
  const fetchCodexUsage = useAppStore((s) => s.fetchCodexUsage)
  const fetchOpenCodeUsage = useAppStore((s) => s.fetchOpenCodeUsage)
  const refreshClaudeUsage = useAppStore((s) => s.refreshClaudeUsage)
  const refreshCodexUsage = useAppStore((s) => s.refreshCodexUsage)
  const refreshOpenCodeUsage = useAppStore((s) => s.refreshOpenCodeUsage)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }
    void fetchClaudeUsage()
    void fetchCodexUsage()
    void fetchOpenCodeUsage()
  }, [open, fetchClaudeUsage, fetchCodexUsage, fetchOpenCodeUsage])

  const model = useMemo(
    () =>
      buildUsageOverviewModel({
        rateLimits,
        detectedAgentIds,
        claudeAccount: settings?.claudeManagedAccounts?.[0]?.email ?? null,
        codexAccount: settings?.codexManagedAccounts?.[0]?.email ?? null,
        claudeUsage: {
          scanState: claudeUsageScanState,
          summary: null,
          daily: claudeUsageDaily,
          recentSessions: claudeUsageRecentSessions
        },
        codexUsage: {
          scanState: codexUsageScanState,
          summary: null,
          daily: codexUsageDaily,
          recentSessions: codexUsageRecentSessions
        },
        openCodeUsage: {
          scanState: openCodeUsageScanState,
          summary: null,
          daily: openCodeUsageDaily,
          recentSessions: openCodeUsageRecentSessions
        }
      }),
    [
      rateLimits,
      detectedAgentIds,
      settings?.claudeManagedAccounts,
      settings?.codexManagedAccounts,
      claudeUsageScanState,
      claudeUsageDaily,
      claudeUsageRecentSessions,
      codexUsageScanState,
      codexUsageDaily,
      codexUsageRecentSessions,
      openCodeUsageScanState,
      openCodeUsageDaily,
      openCodeUsageRecentSessions
    ]
  )

  const handleRefresh = async (): Promise<void> => {
    setIsRefreshing(true)
    try {
      await Promise.all([
        refreshRateLimits(),
        refreshDetectedAgents(),
        claudeUsageScanState?.enabled ? refreshClaudeUsage() : Promise.resolve(),
        codexUsageScanState?.enabled ? refreshCodexUsage() : Promise.resolve(),
        openCodeUsageScanState?.enabled ? refreshOpenCodeUsage() : Promise.resolve()
      ])
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle>
              {translate('components.usage.UsageOverviewDialog.title', 'Usage across every CLI')}
            </DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              aria-label={translate('components.usage.UsageOverviewDialog.refresh', 'Refresh usage')}
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-3 overflow-y-auto scrollbar-sleek pr-1">
          {model.providers.map((provider) => (
            <UsageOverviewProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
