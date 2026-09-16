import { useCallback, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { basename } from '@/lib/path'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { resolveWorktreeBranchLabel } from '@/lib/worktree-default-display-name'
import { sendBracketedPasteToRunningAgent } from '@/lib/agent-paste-draft'
import { resolveRunningAgentSendTarget } from '@/lib/running-agent-targets'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { formatAgentTypeLabel } from '../../../../shared/agent-type-label'
import {
  cycleComposerTargetPaneKey,
  isComposerSendEnabled,
  resolveDefaultComposerTargetPaneKey
} from './workspace-composer-model'
import {
  useFocusedWorkspacePane,
  useWorkspaceComposerTargets
} from './use-workspace-composer-targets'
import { ComposerAgentPicker } from './ComposerAgentPicker'
import { ComposerYoloChip } from './ComposerYoloChip'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.composer.WorkspaceComposer.${id}`, fallback)

/** The one composer for a workspace, docked under its tab groups in Code
 *  view. Types to exactly one chosen running agent — never "the workspace". */
export function WorkspaceComposer({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const targets = useWorkspaceComposerTargets(worktreeId)
  const focusedPane = useFocusedWorkspacePane(worktreeId)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const worktree = useMemo(
    () => findWorktreeById(worktreesByRepo, worktreeId),
    [worktreesByRepo, worktreeId]
  )
  const branchLabel = useMemo(() => {
    if (!worktree) {
      return ''
    }
    return resolveWorktreeBranchLabel(worktree).trim() || basename(worktree.path).trim()
  }, [worktree])

  const targetSummaries = useMemo(
    () => targets.map(({ target }) => ({ paneKey: target.paneKey, status: target.status })),
    [targets]
  )

  const [explicitPaneKey, setExplicitPaneKey] = useState<string | null>(null)
  const resolvedPaneKey = useMemo(() => {
    if (explicitPaneKey && targetSummaries.some((t) => t.paneKey === explicitPaneKey)) {
      return explicitPaneKey
    }
    return resolveDefaultComposerTargetPaneKey(targetSummaries, focusedPane?.paneKey ?? null)
  }, [explicitPaneKey, targetSummaries, focusedPane])

  const selectedTarget = useMemo(
    () => targets.find(({ target }) => target.paneKey === resolvedPaneKey) ?? null,
    [targets, resolvedPaneKey]
  )

  // Why a ref map, not store state: drafts are per-pane scratch text that
  // never needs to survive a reload or be read outside this component.
  const draftsByPaneKeyRef = useRef<Map<string, string>>(new Map())
  const [, bumpDraftVersion] = useState(0)
  const draft = resolvedPaneKey ? (draftsByPaneKeyRef.current.get(resolvedPaneKey) ?? '') : ''
  const setDraft = useCallback((paneKey: string | null, value: string) => {
    if (!paneKey) {
      return
    }
    draftsByPaneKeyRef.current.set(paneKey, value)
    bumpDraftVersion((v) => v + 1)
  }, [])

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const sendEnabled = isComposerSendEnabled(draft, selectedTarget?.target.status)

  const handleSend = useCallback(() => {
    if (!resolvedPaneKey || !selectedTarget) {
      return
    }
    const content = draft
    const agentLabel = formatAgentTypeLabel(
      selectedTarget.target.agentType ?? selectedTarget.agent?.agentType
    )
    // Why re-resolve here: the chip's status can be a render behind the
    // latest agent event, so confirm eligibility and the live ptyId together
    // right before writing to the pty.
    const current = resolveRunningAgentSendTarget(
      useAppStore.getState(),
      worktreeId,
      resolvedPaneKey
    )
    if (!current || current.status !== 'eligible' || !current.ptyId) {
      toast.message(current?.disabledReason ?? T('unavailable', 'Agent is no longer available'))
      return
    }
    const ptyId = current.ptyId
    void sendBracketedPasteToRunningAgent({ ptyId, content }).then((sent) => {
      if (sent) {
        setDraft(resolvedPaneKey, '')
        toast.success(
          translate('auto.components.composer.WorkspaceComposer.sent', 'Sent to {{value0}}', {
            value0: agentLabel
          })
        )
      } else {
        toast.error(
          translate(
            'auto.components.composer.WorkspaceComposer.send-failed',
            'Could not send to {{value0}}',
            { value0: agentLabel }
          )
        )
      }
    })
  }, [resolvedPaneKey, selectedTarget, draft, worktreeId, setDraft])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (sendEnabled) {
          handleSend()
        }
        return
      }
      if (event.key === 'Tab' && draft.length === 0) {
        event.preventDefault()
        const next = cycleComposerTargetPaneKey(targetSummaries, resolvedPaneKey)
        if (next) {
          setExplicitPaneKey(next)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        textareaRef.current?.blur()
        if (focusedPane) {
          activateTabAndFocusPane(focusedPane.tabId, focusedPane.leafId)
        }
      }
    },
    [sendEnabled, handleSend, draft, targetSummaries, resolvedPaneKey, focusedPane]
  )

  const placeholder =
    targets.length === 0
      ? T('placeholder-empty', 'Start an agent in this workspace to message it')
      : T('placeholder', 'Message the chosen agent…')

  return (
    <div
      className="mx-3 mt-2 mb-2.5 shrink-0 rounded-lg border border-border bg-card p-3"
      data-workspace-composer={worktreeId}
    >
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => setDraft(resolvedPaneKey, event.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        disabled={targets.length === 0}
        placeholder={placeholder}
        className={cn(
          'scrollbar-sleek w-full resize-none bg-transparent text-sm outline-none',
          '[field-sizing:content] max-h-[calc(6lh+0.5rem)]',
          'placeholder:text-muted-foreground/60 disabled:cursor-not-allowed disabled:opacity-50'
        )}
      />
      <div className="mt-2 flex items-center gap-1.5">
        <ComposerAgentPicker
          targets={targets}
          selectedPaneKey={resolvedPaneKey}
          onSelect={setExplicitPaneKey}
        />
        <ComposerYoloChip worktreeId={worktreeId} />
        {branchLabel ? (
          <span className="rounded-md px-2 text-xs font-mono text-muted-foreground">
            {branchLabel}
          </span>
        ) : null}
        <div className="ml-auto">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="icon-sm"
                disabled={!sendEnabled}
                onClick={handleSend}
                aria-label={T('send', 'Send')}
              >
                <ArrowUp />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>
              <span className="flex items-center gap-1.5">
                {T('send', 'Send')}
                <ShortcutKeyCombo keys={['Enter']} />
              </span>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
