import { Loader2 } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { Badge } from '../ui/badge'
import { Progress } from '../ui/progress'
import { ProviderIcon } from '../status-bar/tooltip'
import { formatSessionTime, formatTokens } from '../stats/usage-formatters'
import type { UsageOverviewProvider } from './usage-overview-model'
import { translate } from '@/i18n/i18n'

// usage-overview-model ids that match a ProviderIcon case (opencode's rate-limit
// icon is keyed 'opencode-go'); anything else falls back to the agent catalog icon.
const RATE_LIMIT_ICON_ID: Record<string, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode-go',
  kimi: 'kimi',
  antigravity: 'antigravity',
  minimax: 'minimax',
  grok: 'grok'
}

function ProviderCardIcon({ id }: { id: string }): React.JSX.Element {
  const rateLimitId = RATE_LIMIT_ICON_ID[id]
  if (rateLimitId) {
    return <ProviderIcon provider={rateLimitId} />
  }
  return <AgentIcon agent={id as TuiAgent} size={13} />
}

function usedPercentTextClass(usedPercent: number): string {
  return usedPercent >= 90 ? 'text-agent-question' : 'text-foreground'
}

function WindowMeter({
  label,
  usedPercent,
  resetsInLabel
}: {
  label: string
  usedPercent: number
  resetsInLabel: string | null
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`tabular-nums font-medium ${usedPercentTextClass(usedPercent)}`}>
          {usedPercent}%
        </span>
      </div>
      <Progress
        value={usedPercent}
        className="h-1.5 bg-muted"
        indicatorClassName="bg-muted-foreground/60"
      />
      {resetsInLabel ? (
        <div className="text-[11px] text-muted-foreground">{resetsInLabel}</div>
      ) : null}
    </div>
  )
}

function ProviderStatusNote({
  provider
}: {
  provider: UsageOverviewProvider
}): React.JSX.Element | null {
  if (provider.status === 'fetching') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {translate('components.usage.UsageOverviewProviderCard.fetching', 'Fetching usage…')}
      </div>
    )
  }
  if (provider.status === 'error') {
    return (
      <div className="text-xs text-agent-question">
        {provider.error ??
          translate('components.usage.UsageOverviewProviderCard.error', 'Refresh failed')}
      </div>
    )
  }
  if (
    provider.status === 'unavailable' &&
    provider.windows.length === 0 &&
    !provider.recentSessions
  ) {
    return (
      <div className="text-xs text-muted-foreground">
        {provider.detected
          ? translate(
              'components.usage.UsageOverviewProviderCard.notTracked',
              'Detected, but Kolux does not track its usage yet.'
            )
          : translate(
              'components.usage.UsageOverviewProviderCard.notDetected',
              'Not detected on this machine.'
            )}
      </div>
    )
  }
  return null
}

export function UsageOverviewProviderCard({
  provider
}: {
  provider: UsageOverviewProvider
}): React.JSX.Element {
  const hasRecentSessions = (provider.recentSessions?.length ?? 0) > 0

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ProviderCardIcon id={provider.id} />
            {provider.label}
          </div>
          {provider.account ? (
            <div className="truncate text-xs text-muted-foreground">{provider.account}</div>
          ) : null}
        </div>
        {provider.todayTokens !== undefined ? (
          <Badge variant="outline" className="shrink-0">
            {translate('components.usage.UsageOverviewProviderCard.today', 'Today')}{' '}
            {formatTokens(provider.todayTokens)}
          </Badge>
        ) : null}
      </div>

      <ProviderStatusNote provider={provider} />

      {provider.windows.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {provider.windows.map((window) => (
            <WindowMeter
              key={window.label}
              label={window.label}
              usedPercent={window.usedPercent}
              resetsInLabel={window.resetsInLabel}
            />
          ))}
        </div>
      ) : null}

      {hasRecentSessions ? (
        <div className="space-y-1 border-t border-border/50 pt-2">
          <div className="text-[11px] font-medium text-muted-foreground">
            {translate(
              'components.usage.UsageOverviewProviderCard.recentSessions',
              'Recent sessions'
            )}
          </div>
          <ul className="max-h-32 space-y-1 overflow-y-auto scrollbar-sleek text-xs">
            {provider.recentSessions?.map((session) => (
              <li
                key={`${session.when}-${session.label}-${session.tokens}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0 truncate text-foreground">{session.label}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatTokens(session.tokens)} · {formatSessionTime(session.when)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
