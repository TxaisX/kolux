import { useCallback, useMemo } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { resolveWorktreeAgentPermissionMode } from '@/lib/worktree-agent-permission-mode'
import { useAppStore } from '@/store'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.composer.ComposerYoloChip.${id}`, fallback)

/** Chip 2: per-workspace YOLO (skip-permissions) toggle for the next agent launch. */
export function ComposerYoloChip({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const explicitMode = useAppStore((s) => s.agentPermissionModeByWorktree[worktreeId])
  const agentDefaultArgs = useAppStore((s) => s.settings?.agentDefaultArgs)
  const agentDefaultEnv = useAppStore((s) => s.settings?.agentDefaultEnv)
  const setAgentPermissionModeForWorktree = useAppStore((s) => s.setAgentPermissionModeForWorktree)
  const isOn = useMemo(
    () =>
      resolveWorktreeAgentPermissionMode(
        {
          agentPermissionModeByWorktree: explicitMode ? { [worktreeId]: explicitMode } : {},
          settings: { agentDefaultArgs, agentDefaultEnv }
        },
        worktreeId
      ) === 'yolo',
    [agentDefaultArgs, agentDefaultEnv, explicitMode, worktreeId]
  )

  const toggle = useCallback(() => {
    setAgentPermissionModeForWorktree(worktreeId, isOn ? 'manual' : 'yolo')
  }, [isOn, setAgentPermissionModeForWorktree, worktreeId])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-pressed={isOn}
          onClick={toggle}
          className={cn(
            'inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium',
            isOn ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60'
          )}
        >
          {isOn ? T('on', 'YOLO on') : T('off', 'YOLO off')}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {T(
          'tooltip',
          'Skip permission prompts for agents launched in this workspace. Takes effect on the next launch.'
        )}
      </TooltipContent>
    </Tooltip>
  )
}
