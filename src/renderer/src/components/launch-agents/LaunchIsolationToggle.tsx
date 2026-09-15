import React from 'react'
import { FolderGit2, FolderOpen } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { LaunchIsolationMode } from './launch-agents-requests'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.launch-agents.LaunchIsolationToggle.${id}`, fallback)

/**
 * ISOLATION section: New worktree (one checkout per seat) vs. Shared
 * checkout (every seat opens a terminal pane in the same folder, no worktree
 * or branch). A non-git folder workspace has no worktrees at all, so New
 * worktree is disabled and Shared checkout is the only option.
 */
export function LaunchIsolationToggle({
  mode,
  onChange,
  newWorktreeAvailable
}: {
  mode: LaunchIsolationMode
  onChange: (mode: LaunchIsolationMode) => void
  newWorktreeAvailable: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={mode === 'new-worktree'}
          disabled={!newWorktreeAvailable}
          onClick={() => onChange('new-worktree')}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            mode === 'new-worktree'
              ? 'border-primary bg-accent text-foreground'
              : 'border-border bg-background text-foreground hover:border-muted-foreground/35 hover:bg-accent'
          }`}
        >
          <FolderGit2 className="size-3.5" aria-hidden="true" />
          {T('newWorktree', 'New worktree')}
        </button>
        <button
          type="button"
          aria-pressed={mode === 'shared-checkout'}
          onClick={() => onChange('shared-checkout')}
          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
            mode === 'shared-checkout'
              ? 'border-primary bg-accent text-foreground'
              : 'border-border bg-background text-foreground hover:border-muted-foreground/35 hover:bg-accent'
          }`}
        >
          <FolderOpen className="size-3.5" aria-hidden="true" />
          {T('sharedCheckout', 'Shared checkout')}
        </button>
      </div>
      {newWorktreeAvailable ? null : (
        <p className="text-xs text-muted-foreground">{T('notGitRepo', 'Not a git repository.')}</p>
      )}
    </div>
  )
}
