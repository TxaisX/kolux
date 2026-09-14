import React from 'react'
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, RotateCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getUpdateCheckClickOptions } from '@/lib/update-check-click-options'
import type { UpdateStatus } from '../../../../shared/update-status-types'

type SidebarUpdateAction = 'check' | 'download' | 'install' | null

export type SidebarUpdateButtonModel = {
  kind: UpdateStatus['state']
  label: string
  tooltip: string
  action: SidebarUpdateAction
  emphasized: boolean
}

const NO_MODIFIERS = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }

export function getSidebarUpdateButtonModel(status: UpdateStatus): SidebarUpdateButtonModel {
  const base = { kind: status.state, emphasized: false }
  switch (status.state) {
    case 'checking':
      return {
        ...base,
        label: translate('auto.components.sidebar.SidebarUpdateButton.3b1f7c2a90', 'Checking…'),
        tooltip: translate(
          'auto.components.sidebar.SidebarUpdateButton.8d42e61b07',
          'Checking GitHub for a newer version'
        ),
        action: null
      }
    case 'not-available':
      return {
        ...base,
        label: translate('auto.components.sidebar.SidebarUpdateButton.c7a09e3f51', 'Up to date'),
        tooltip: translate(
          'auto.components.sidebar.SidebarUpdateButton.1e6d8b4c23',
          'You have the latest version. Click to check again.'
        ),
        action: 'check'
      }
    case 'available':
      return {
        ...base,
        emphasized: true,
        label: translate(
          'auto.components.sidebar.SidebarUpdateButton.5a2f9d7e84',
          'Update to v{{value0}}',
          { value0: status.version }
        ),
        tooltip: translate(
          'auto.components.sidebar.SidebarUpdateButton.9b3c6e1d45',
          'Download Nightshift v{{value0}}',
          { value0: status.version }
        ),
        action: 'download'
      }
    case 'downloading': {
      const pct = Math.max(0, Math.min(100, Math.round(status.percent)))
      return {
        ...base,
        label: translate(
          'auto.components.sidebar.SidebarUpdateButton.4f8e2a6c19',
          'Downloading {{value0}}%',
          { value0: pct }
        ),
        tooltip: translate(
          'auto.components.sidebar.SidebarUpdateButton.d2b7f0a938',
          'Downloading Nightshift v{{value0}}',
          { value0: status.version }
        ),
        action: null
      }
    }
    case 'downloaded':
      return {
        ...base,
        emphasized: true,
        label: translate(
          'auto.components.sidebar.SidebarUpdateButton.6e1a4d9b72',
          'Restart to update'
        ),
        tooltip: translate(
          'auto.components.sidebar.SidebarUpdateButton.a8c5e3f201',
          'Restart Nightshift to install v{{value0}}',
          { value0: status.version }
        ),
        action: 'install'
      }
    case 'error':
      return {
        ...base,
        label: translate('auto.components.sidebar.SidebarUpdateButton.0c9d7b5e36', 'Update failed'),
        tooltip: translate(
          'auto.components.sidebar.SidebarUpdateButton.e4f1b8c627',
          'Update failed. Click to try again.'
        ),
        action: 'check'
      }
    case 'idle':
      return {
        ...base,
        label: translate(
          'auto.components.sidebar.SidebarUpdateButton.7d3a0f6e58',
          'Check for updates'
        ),
        tooltip: translate(
          'auto.components.sidebar.SidebarUpdateButton.b6e2c9a417',
          'Check GitHub for a newer version'
        ),
        action: 'check'
      }
  }
}

export function runSidebarUpdateAction(action: SidebarUpdateAction): void {
  if (action === 'check') {
    void window.api.updater.check(getUpdateCheckClickOptions(NO_MODIFIERS))
  } else if (action === 'download') {
    void window.api.updater.download()
  } else if (action === 'install') {
    void window.api.updater.quitAndInstall().catch((error: unknown) => {
      toast.error(
        translate(
          'auto.components.sidebar.SidebarUpdateButton.2a7f5c8d90',
          "Couldn't restart to install the update."
        ),
        { description: error instanceof Error ? error.message : undefined }
      )
    })
  }
}

function UpdateIcon({ kind }: { kind: UpdateStatus['state'] }): React.JSX.Element {
  if (kind === 'checking' || kind === 'downloading') {
    return <Loader2 className="size-3.5 animate-spin" />
  }
  if (kind === 'available') {
    return <Download className="size-3.5" />
  }
  if (kind === 'downloaded') {
    return <RotateCw className="size-3.5 text-emerald-500" />
  }
  if (kind === 'not-available') {
    return <CheckCircle2 className="size-3.5" />
  }
  if (kind === 'error') {
    return <AlertCircle className="size-3.5 text-yellow-500" />
  }
  return <RefreshCw className="size-3.5" />
}

export function SidebarUpdateButton(): React.JSX.Element {
  const status = useAppStore((s) => s.updateStatus)
  const model = getSidebarUpdateButtonModel(status)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={model.emphasized ? 'secondary' : 'ghost'}
          size="xs"
          type="button"
          data-update-state={model.kind}
          disabled={model.action === null}
          onClick={() => runSidebarUpdateAction(model.action)}
          className={model.emphasized ? 'min-w-0' : 'min-w-0 text-muted-foreground'}
        >
          <UpdateIcon kind={model.kind} />
          <span className="truncate tabular-nums">{model.label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {model.tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
