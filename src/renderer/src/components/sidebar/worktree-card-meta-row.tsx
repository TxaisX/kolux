import React from 'react'
import { GitMerge } from 'lucide-react'

import { DetachedHeadBadge } from '@/components/DetachedHeadBadge'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import CacheTimer from './CacheTimer'
import { CONFLICT_OPERATION_LABELS } from './WorktreeCardHelpers'
import { TruncatedSidebarLabel } from './truncated-sidebar-label'
import { getDirectoryName } from './worktree-card-model'
import type { WorktreeCardPresentation } from './worktree-card-presentation'
import type { WorktreeCardController } from './use-worktree-card-controller'

// Why: one shared attention style for every amber sidebar badge (conflict-operation and unpushed).
const AMBER_ATTENTION_BADGE_CLASSNAME =
  'h-[16px] px-1.5 text-[10px] font-medium rounded shrink-0 gap-1 text-amber-600 border-amber-500/30 bg-amber-500/5 dark:text-amber-400 dark:border-amber-400/30 dark:bg-amber-400/5 leading-none'

export function WorktreeCardMetaRow({
  card,
  presentation
}: {
  card: WorktreeCardController
  presentation: WorktreeCardPresentation
}): React.JSX.Element {
  const {
    worktree,
    repo,
    hostContextLabel,
    identityDisplay,
    isFolder,
    newCardStyle,
    branch,
    detachedHeadDisplay,
    conflictOperation,
    unpushedStatus,
    cacheStartedAt,
    cacheTtlMs
  } = card
  const {
    showRepoBadgeInMetaRow,
    showHostContextBadge,
    showIdentityInNewCard,
    hasHoverDetails,
    showBranch,
    showDetachedHeadInMetaRow,
    showConflictOperationBadge,
    showUnpushedBadge,
    showMetaRowDetails,
    detailsAndPorts
  } = presentation

  return (
    <div className="flex items-center gap-1.5 min-w-0" data-worktree-card-meta-row="">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {showRepoBadgeInMetaRow && repo && (
          <div className="flex items-center gap-1.5 shrink-0 px-1.5 py-0.5 rounded-[4px] bg-accent border border-border dark:bg-accent/50 dark:border-border/60">
            <RepoBadgeMark color={repo.badgeColor} />
            <span className="text-[10px] font-semibold text-foreground truncate max-w-[6rem] leading-none lowercase">
              {repo.displayName}
            </span>
          </div>
        )}

        {showHostContextBadge && (
          <Badge
            variant="secondary"
            className="h-[16px] max-w-[7rem] shrink-0 rounded border border-border bg-accent px-1.5 text-[10px] font-medium leading-none text-muted-foreground dark:bg-accent/80 dark:border-border/50"
          >
            <span className="truncate">{hostContextLabel}</span>
          </Badge>
        )}

        {showIdentityInNewCard ? (
          <TruncatedSidebarLabel
            text={identityDisplay!}
            className="text-[11px] text-muted-foreground leading-none"
            tooltipEnabled={!hasHoverDetails}
          />
        ) : isFolder && !newCardStyle ? (
          <span
            className="min-w-0 truncate font-mono text-[11px] leading-none text-muted-foreground"
            title={worktree.path}
          >
            {getDirectoryName(worktree.path)}
          </span>
        ) : showBranch ? (
          <TruncatedSidebarLabel
            text={branch}
            className="text-[11px] text-muted-foreground leading-none"
            // Why: whole-card details hover already shows full identity; a nested tooltip would compete for it.
            tooltipEnabled={!hasHoverDetails}
          />
        ) : showDetachedHeadInMetaRow && detachedHeadDisplay ? (
          <DetachedHeadBadge
            display={detachedHeadDisplay}
            label="sidebar"
            side="right"
            className="h-[16px]"
          />
        ) : null}

        {showConflictOperationBadge && (
          <Badge variant="outline" className={AMBER_ATTENTION_BADGE_CLASSNAME}>
            <GitMerge className="size-2.5" />
            {CONFLICT_OPERATION_LABELS[conflictOperation]}
          </Badge>
        )}

        {showUnpushedBadge &&
          unpushedStatus &&
          (unpushedStatus.kind === 'ahead' || unpushedStatus.kind === 'unpublished') && (
            <WorktreeCardUnpushedBadge unpushedStatus={unpushedStatus} />
          )}

        {cacheStartedAt != null && <CacheTimer startedAt={cacheStartedAt} ttlMs={cacheTtlMs} />}
      </div>

      {showMetaRowDetails && (
        <div className="ml-auto flex shrink-0 items-center gap-1 pr-1.5">{detailsAndPorts}</div>
      )}
    </div>
  )
}

/** "↑N unpushed" for a branch ahead of its upstream, or "Unpublished" for local-only
 *  commits with no upstream at all — see docs/reference/ssh-execution-boundary.md for
 *  why unresolved (SSH) statuses render nothing rather than a guess. */
function WorktreeCardUnpushedBadge({
  unpushedStatus
}: {
  unpushedStatus: Extract<
    WorktreeCardController['unpushedStatus'],
    { kind: 'ahead' | 'unpublished' }
  >
}): React.JSX.Element {
  if (unpushedStatus.kind === 'ahead') {
    return (
      <Badge variant="outline" className={AMBER_ATTENTION_BADGE_CLASSNAME}>
        {translate('sidebar.worktreeCard.unpushedBadge.ahead', '↑{{count}} unpushed', {
          count: unpushedStatus.count
        })}
      </Badge>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={AMBER_ATTENTION_BADGE_CLASSNAME}>
          {translate('sidebar.worktreeCard.unpushedBadge.unpublished', 'Unpublished')}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {translate(
          'sidebar.worktreeCard.unpushedBadge.unpublishedTooltip',
          '{{count}} commits not on any remote',
          { count: unpushedStatus.count }
        )}
      </TooltipContent>
    </Tooltip>
  )
}
