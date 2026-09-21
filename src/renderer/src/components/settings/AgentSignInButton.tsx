import { useState } from 'react'
import { toast } from 'sonner'
import { useAppStore, type AppState } from '@/store'
import { translate } from '@/i18n/i18n'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { getAgentDetectionTargetKeyForWorktree } from '@/hooks/useAgentDetectionTarget'
import { launchAgentsIntoWorkspace } from '../launch-agents/launch-agents-into-workspace'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.settings.AgentSignInButton.${id}`, fallback)

export function openAgentAccountSettings(agent: TuiAgent): boolean {
  const provider = agent === 'claude-agent-teams' ? 'claude' : agent
  if (provider !== 'codex' && provider !== 'claude') {
    return false
  }
  const state = useAppStore.getState()
  state.openSettingsTarget({ pane: 'accounts', repoId: null, sectionId: `accounts-${provider}` })
  state.openSettingsPage()
  return true
}

export function canOpenAgentSetupInWorkspace(state: AppState = useAppStore.getState()): boolean {
  if (!state.activeWorktreeId) {
    return false
  }
  const owner = getAgentDetectionTargetKeyForWorktree(state, state.activeWorktreeId)
  const expected = state.settings?.activeRuntimeEnvironmentId?.trim()
  return owner === (expected ? `runtime:${expected}` : 'local')
}

export function openAgentSetupInWorkspace(agent: TuiAgent): boolean {
  if (!canOpenAgentSetupInWorkspace()) {
    return false
  }
  const state = useAppStore.getState()
  if (!state.activeWorktreeId) {
    return false
  }
  if (launchAgentsIntoWorkspace(state.activeWorktreeId, [{ agent, prompt: '' }]) !== 1) {
    return false
  }
  state.setActiveView('terminal')
  return true
}

export function AgentSignInButton({
  agent,
  label,
  homepageUrl
}: {
  agent: TuiAgent
  label: string
  homepageUrl: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const canLaunch = useAppStore((s) => canOpenAgentSetupInWorkspace(s))
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={() => {
          if (!openAgentAccountSettings(agent)) {
            setOpen(true)
          }
        }}
      >
        {T('signIn', 'Sign in / accounts')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {label} · {T('title', 'Sign in')}
            </DialogTitle>
            <DialogDescription>
              {T(
                'description',
                'Open the CLI in a Nightshift pane and follow its sign-in or provider setup instructions. If it offers browser authorization, finish on the provider’s website and return to the pane.'
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {T(
              'providerSupport',
              'Each CLI controls its login methods. Some use a subscription in your browser; others require an API key. Nightshift never asks for your provider password.'
            )}
          </p>
          {!canLaunch && (
            <p className="text-xs text-muted-foreground">
              {T(
                'workspaceRequired',
                'Select a workspace on the same host as this agent before opening its CLI.'
              )}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" asChild>
              <a href={homepageUrl} target="_blank" rel="noopener noreferrer">
                {T('docs', 'Provider instructions')}
              </a>
            </Button>
            <Button
              disabled={!canLaunch}
              onClick={() => {
                try {
                  if (!openAgentSetupInWorkspace(agent)) {
                    throw new Error(
                      T(
                        'launchFailed',
                        'Could not open the CLI. Select its workspace and try again.'
                      )
                    )
                  }
                  setOpen(false)
                } catch (error) {
                  toast.error(
                    T(
                      'launchFailed',
                      'Could not open the CLI. Select its workspace and try again.'
                    ),
                    { description: String(error) }
                  )
                }
              }}
            >
              {T('openCli', 'Open CLI in Nightshift')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
