import type { WorkspacePort } from '../../../../shared/workspace-ports'
import type { BrowserWorkspace } from '../../../../shared/browser-workspace-types'
import { workspacePortOwnerWorktreeId } from '@/lib/workspace-port-actions'
import { browserUrlForPort } from '@/lib/workspace-port-urls'

export type WorkspacePreviewCandidate = {
  port: WorkspacePort & { kind: 'workspace' }
  url: string
  origin: string | null
  label: string
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function safeHost(url: string, fallback: string): string {
  try {
    return new URL(url).host
  } catch {
    return fallback
  }
}

// Rank: an advertised URL (the dev server's own printed origin) first, then a
// known protocol (http/https) over 'unknown', then the lowest port number —
// dev servers conventionally bind their primary port lowest (5173, 3000)
// with tooling (HMR socket, inspector) on higher ones.
function rankTuple(port: WorkspacePort & { kind: 'workspace' }): [number, number, number] {
  return [port.advertisedUrl ? 0 : 1, port.protocol === 'unknown' ? 1 : 0, port.port]
}

/** Ranked dev-server candidates for a workspace's "Preview" button: every
 *  `kind: 'workspace'` port owned by `worktreeId`, best candidate first. */
export function selectWorkspacePreviewCandidates(
  ports: readonly WorkspacePort[],
  worktreeId: string
): WorkspacePreviewCandidate[] {
  const owned = ports.filter(
    (port): port is WorkspacePort & { kind: 'workspace' } =>
      port.kind === 'workspace' && workspacePortOwnerWorktreeId(port) === worktreeId
  )
  return owned
    .map((port) => {
      const url = port.advertisedUrl ?? browserUrlForPort(port)
      return {
        port,
        url,
        origin: safeOrigin(url),
        label: safeHost(url, `${port.connectHost}:${port.port}`)
      }
    })
    .sort((a, b) => {
      const ta = rankTuple(a.port)
      const tb = rankTuple(b.port)
      return ta[0] - tb[0] || ta[1] - tb[1] || ta[2] - tb[2]
    })
}

/** The existing browser tab in this worktree already showing `origin`, if any.
 *  `BrowserWorkspace.url` mirrors its active page, so this catches the common
 *  "already open" case without walking every page of every tab. */
export function findExistingPreviewTab(
  browserTabs: readonly BrowserWorkspace[],
  origin: string | null
): BrowserWorkspace | null {
  if (!origin) {
    return null
  }
  return browserTabs.find((tab) => safeOrigin(tab.url) === origin) ?? null
}
