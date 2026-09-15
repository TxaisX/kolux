import React from 'react'
import { translate } from '@/i18n/i18n'

const T = (id: string, fallback: string, options?: Record<string, unknown>): string =>
  translate(`auto.components.launch-agents.LaunchSeatCountPicker.${id}`, fallback, options)

const QUICK_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

/**
 * HOW MANY section: quick pills for the common counts plus a free-entry
 * number input for anything larger. No upper bound — the user decides how
 * many agents their machine can run.
 */
export function LaunchSeatCountPicker({
  count,
  onChange
}: {
  count: number
  onChange: (count: number) => void
}): React.JSX.Element {
  const isCustom = !QUICK_COUNTS.includes(count as (typeof QUICK_COUNTS)[number])
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {QUICK_COUNTS.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={count === value}
          onClick={() => onChange(value)}
          className={`flex size-7 items-center justify-center rounded-full border text-xs font-medium tabular-nums transition-colors ${
            count === value
              ? 'border-primary bg-accent text-foreground'
              : 'border-border bg-background text-foreground hover:border-muted-foreground/35 hover:bg-accent'
          }`}
        >
          {value}
        </button>
      ))}
      <input
        type="number"
        min={1}
        step={1}
        aria-label={T('customCount', 'Custom session count')}
        value={isCustom ? count : ''}
        placeholder={T('more', 'More…')}
        onChange={(event) => {
          const next = Math.floor(Number(event.target.value))
          if (Number.isFinite(next) && next >= 1) {
            onChange(next)
          }
        }}
        className="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs tabular-nums"
      />
      <span className="text-xs text-muted-foreground">
        {count === 1 ? T('session', 'session') : T('sessions', 'sessions')}
      </span>
    </div>
  )
}
