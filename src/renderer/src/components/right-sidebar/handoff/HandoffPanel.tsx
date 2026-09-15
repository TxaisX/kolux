import { useEffect, useReducer, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, NotebookPen } from 'lucide-react'
import { useAppStore } from '@/store'
import { Textarea } from '@/components/ui/textarea'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { getAgentLabel } from '@/lib/agent-catalog'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { useWorkspaceHandoffTarget } from './handoff-workspace-target'
import { HandoffAgentPicker } from './HandoffAgentPicker'
import {
  createHandoffAutosaveState,
  reduceHandoffAutosave,
  type HandoffAutosaveStatus
} from './handoff-autosave'

const T = (id: string, fallback: string, options?: Record<string, unknown>): string =>
  translate(`auto.components.right-sidebar.handoff.HandoffPanel.${id}`, fallback, options)

const IDLE_FLUSH_MS = 800

function statusLabel(status: HandoffAutosaveStatus, updatedAt: number | null): string {
  if (status === 'saving') {
    return T('saving', 'Saving…')
  }
  if (status === 'error') {
    return T('saveError', 'Failed to save')
  }
  if (status === 'saved') {
    return T('saved', 'Saved')
  }
  if (updatedAt) {
    return T('updated', 'Updated {{value0}} ago', { value0: formatShortTimeAgo(updatedAt) })
  }
  return ''
}

/**
 * Collapsible "Handoff" section docked in the right sidebar, shown for every workspace kind
 * (git worktree or folder, local or SSH/WSL) rather than as an activity-bar tab — the tab set
 * is a closed union another slice owns, so a section is the extension point here.
 */
export function HandoffPanel(): React.JSX.Element | null {
  const target = useWorkspaceHandoffTarget()
  const cacheEntry = useAppStore((s) => (target ? s.workspaceHandoffByKey[target.key] : undefined))
  const loadWorkspaceHandoff = useAppStore((s) => s.loadWorkspaceHandoff)
  const saveWorkspaceHandoff = useAppStore((s) => s.saveWorkspaceHandoff)
  const [expanded, setExpanded] = useState(false)
  const [autosave, dispatch] = useReducer(reduceHandoffAutosave, undefined, () =>
    createHandoffAutosaveState()
  )
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedKeyRef = useRef<string | null>(null)
  const targetKeyRef = useRef<string | null>(null)
  const pendingSaveRef = useRef<{ key: string; text: string } | null>(null)

  useEffect(() => {
    targetKeyRef.current = target?.key ?? null
  }, [target])

  useEffect(() => {
    if (target) {
      void loadWorkspaceHandoff(target.key)
    }
  }, [target, loadWorkspaceHandoff])

  useEffect(() => {
    if (target && cacheEntry?.status === 'loaded' && loadedKeyRef.current !== target.key) {
      loadedKeyRef.current = target.key
      dispatch({ type: 'loaded', text: cacheEntry.record?.text ?? '' })
    }
  }, [target, cacheEntry])

  // Why: depends only on status (not target/text) so a workspace switch mid-save can never
  // redirect an in-flight save at the wrong key — the key/text were pinned at flush time.
  useEffect(() => {
    if (autosave.status !== 'saving') {
      return
    }
    const pending = pendingSaveRef.current
    if (!pending) {
      return
    }
    let cancelled = false
    void saveWorkspaceHandoff(pending.key, pending.text).then((record) => {
      if (cancelled || targetKeyRef.current !== pending.key) {
        return
      }
      dispatch(record ? { type: 'save-succeeded', text: pending.text } : { type: 'save-failed' })
    })
    return () => {
      cancelled = true
    }
  }, [autosave.status, saveWorkspaceHandoff])

  useEffect(
    () => () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
      }
    },
    []
  )

  if (!target) {
    return null
  }

  const triggerFlush = (text: string): void => {
    pendingSaveRef.current = { key: target.key, text }
    dispatch({ type: 'flush' })
  }

  const scheduleIdleFlush = (text: string): void => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
    }
    idleTimerRef.current = setTimeout(() => triggerFlush(text), IDLE_FLUSH_MS)
  }

  const flushNow = (): void => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
    triggerFlush(autosave.text)
  }

  const handleHandToAgent = (agent: TuiAgent): void => {
    const stamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    const separator = autosave.text && !autosave.text.endsWith('\n') ? '\n\n' : ''
    const nextText = `${autosave.text}${separator}— Handed to ${getAgentLabel(agent)} at ${stamp}`
    launchAgentInNewTab({
      agent,
      worktreeId: target.launchWorkspaceId,
      prompt: `Handoff for ${target.name}:\n\n${autosave.text}`,
      promptDelivery: 'auto-submit'
    })
    dispatch({ type: 'edit', text: nextText })
    triggerFlush(nextText)
  }

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="shrink-0 border-t border-border"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
        {expanded ? (
          <ChevronDown className="size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5" aria-hidden="true" />
        )}
        <NotebookPen className="size-3.5" aria-hidden="true" />
        <span>{T('title', 'Handoff')}</span>
        <span className="ml-auto font-normal normal-case text-muted-foreground/70">
          {statusLabel(autosave.status, cacheEntry?.record?.updatedAt ?? null)}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 px-3 pb-3">
        <p className="text-[11px] text-muted-foreground">
          {T('scopeHint', 'Private to {{value0}}. Never merged across workspaces.', {
            value0: target.name
          })}
        </p>
        <Textarea
          value={autosave.text}
          onChange={(event) => {
            const text = event.target.value
            dispatch({ type: 'edit', text })
            scheduleIdleFlush(text)
          }}
          onBlur={flushNow}
          placeholder={T(
            'placeholder',
            'What the next agent picking up this workspace needs to know…'
          )}
          className="min-h-32 font-mono text-xs"
        />
        <div className="flex items-center justify-between">
          <HandoffAgentPicker worktreeId={target.launchWorkspaceId} onPick={handleHandToAgent} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
