import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'

export function AccountSignInNotice({ pending }: { pending: boolean }): React.JSX.Element {
  return (
    <div
      role={pending ? 'status' : undefined}
      className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      {pending && <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" />}
      <p>
        {pending
          ? translate(
              'auto.components.settings.AccountSignInNotice.pending',
              'Finish signing in and authorizing in your browser, then return here. Waiting for the provider to save your credentials…'
            )
          : translate(
              'auto.components.settings.AccountSignInNotice.ready',
              'Add Account opens the provider’s browser sign-in. Choose the subscription you want to add; the account appears here only after authorization succeeds. Repeat to add another account, then select it when you need to switch.'
            )}
      </p>
    </div>
  )
}
