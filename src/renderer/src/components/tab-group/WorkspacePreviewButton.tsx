import { useCallback, useMemo } from 'react'
import { ChevronDown, Globe } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { openWorkspacePortInBrowser } from '@/lib/workspace-port-actions'
import { useLocalhostLabelRouteForPort } from '@/lib/workspace-port-localhost-label-selector'
import { useWorktreeRuntimeTarget } from '@/runtime/use-worktree-runtime-target'
import {
  findExistingPreviewTab,
  selectWorkspacePreviewCandidates,
  type WorkspacePreviewCandidate
} from './workspace-preview-target'
import type { LocalhostWorktreeLabelRoute } from '../../../../shared/localhost-worktree-labels'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import type { BrowserWorkspace } from '../../../../shared/browser-workspace-types'

const T = (id: string, fallback: string, vars?: Record<string, string | number>): string =>
  translate(`auto.components.tab.group.WorkspacePreviewButton.${id}`, fallback, vars)

const EMPTY_BROWSER_TABS: readonly BrowserWorkspace[] = []

// Why: useLocalhostLabelRouteForPort must run unconditionally (rules of hooks)
// even when there is no real candidate yet — this satisfies its WorkspacePort
// param without standing for a real listener.
const NO_CANDIDATE_PORT: WorkspacePort = {
  id: 'workspace-preview-none',
  bindHost: '127.0.0.1',
  connectHost: '127.0.0.1',
  port: 0,
  protocol: 'unknown',
  kind: 'external'
}

function useOpenPreviewCandidate(
  worktreeId: string,
  groupId: string
): (
  candidate: WorkspacePreviewCandidate,
  localhostLabelRoute: LocalhostWorktreeLabelRoute | null
) => void {
  const runtimeTarget = useWorktreeRuntimeTarget(worktreeId)
  const createBrowserTab = useAppStore((s) => s.createBrowserTab)
  const setRemoteBrowserPageHandle = useAppStore((s) => s.setRemoteBrowserPageHandle)
  const focusBrowserTabInWorktree = useAppStore((s) => s.focusBrowserTabInWorktree)
  const browserTabs = useAppStore((s) => s.browserTabsByWorktree[worktreeId]) ?? EMPTY_BROWSER_TABS

  return useCallback(
    (candidate, localhostLabelRoute) => {
      const existing = findExistingPreviewTab(browserTabs, candidate.origin)
      if (existing?.activePageId) {
        focusBrowserTabInWorktree(worktreeId, existing.activePageId)
        return
      }
      void openWorkspacePortInBrowser({
        port: candidate.port,
        activeWorktreeId: worktreeId,
        runtimeTarget,
        createBrowserTab: (targetWorktreeId, url, options) =>
          createBrowserTab(targetWorktreeId, url, {
            ...options,
            targetGroupId: groupId,
            title: T('previewTabTitle', 'Preview · {{value0}}', { value0: candidate.label })
          }),
        setRemoteBrowserPageHandle,
        openInKoluxBrowser: true,
        localhostLabelRoute
      }).then((result) => {
        if (!result.ok) {
          toast.error(T('openFailed', 'Failed to open preview'), { description: result.reason })
        }
      })
    },
    [
      browserTabs,
      createBrowserTab,
      focusBrowserTabInWorktree,
      groupId,
      runtimeTarget,
      setRemoteBrowserPageHandle,
      worktreeId
    ]
  )
}

function PreviewCandidateMenuItem({
  candidate,
  onOpen
}: {
  candidate: WorkspacePreviewCandidate
  onOpen: (candidate: WorkspacePreviewCandidate, route: LocalhostWorktreeLabelRoute | null) => void
}): React.JSX.Element {
  const route = useLocalhostLabelRouteForPort(candidate.port)
  return (
    <DropdownMenuItem onSelect={() => onOpen(candidate, route)}>{candidate.label}</DropdownMenuItem>
  )
}

/** "Preview" toolbar button — opens the focused workspace's detected dev
 *  server in an embedded browser pane in this tab group, or activates it if
 *  already open. A caret lists other detected ports when there is more than
 *  one candidate. Disabled with a tooltip when none is detected. */
export default function WorkspacePreviewButton({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element {
  const scan = useAppStore((s) => s.workspacePortScan)
  const candidates = useMemo(
    () => selectWorkspacePreviewCandidates(scan?.result.ports ?? [], worktreeId),
    [scan, worktreeId]
  )
  const bestCandidate = candidates[0] ?? null
  const otherCandidates = candidates.slice(1)
  const openCandidate = useOpenPreviewCandidate(worktreeId, groupId)
  const primaryLocalhostRoute = useLocalhostLabelRouteForPort(
    bestCandidate?.port ?? NO_CANDIDATE_PORT
  )

  const previewLabel = T('preview', 'Preview')
  const noServerLabel = T('noServer', 'No dev server detected')
  const disabled = !bestCandidate

  const handlePrimaryClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      if (!bestCandidate) {
        return
      }
      openCandidate(bestCandidate, primaryLocalhostRoute)
    },
    [bestCandidate, openCandidate, primaryLocalhostRoute]
  )

  const primaryButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={previewLabel}
      disabled={disabled}
      onClick={handlePrimaryClick}
    >
      <Globe className="size-3.5" />
    </Button>
  )

  return (
    <div className="flex items-center" data-workspace-preview-button={worktreeId}>
      <Tooltip>
        <TooltipTrigger asChild>
          {disabled ? <span className="inline-flex">{primaryButton}</span> : primaryButton}
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {disabled ? noServerLabel : previewLabel}
        </TooltipContent>
      </Tooltip>
      {otherCandidates.length > 0 ? (
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={T('morePreviewTargets', 'More preview targets')}
                  onClick={(event) => event.stopPropagation()}
                >
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {T('morePreviewTargets', 'More preview targets')}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            {otherCandidates.map((candidate) => (
              <PreviewCandidateMenuItem
                key={candidate.port.id}
                candidate={candidate}
                onOpen={openCandidate}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
