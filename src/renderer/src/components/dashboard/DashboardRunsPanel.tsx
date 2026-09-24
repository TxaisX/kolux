import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { runtimeTargetForExecutionHostId } from '@/runtime/runtime-client-target'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { translate } from '@/i18n/i18n'

// Local mirror of main's RunRow/TaskRow (main/runtime/orchestration/types.ts) —
// not imported directly so the renderer tsconfig project doesn't have to include main.
type TaskStatus = 'pending' | 'ready' | 'dispatched' | 'completed' | 'failed' | 'blocked'
type RunSummary = {
  id: string
  objective: string
  created_at: string
  coordinator_handle: string | null
  legacy: number
}
type TaskSummary = {
  id: string
  task_title: string | null
  display_name: string | null
  spec: string
  status: TaskStatus
}
type RunPage = { runs: RunSummary[]; nextCursor: string | null }
type TaskPage = { tasks: TaskSummary[]; count: number }

const T = (id: string, fallback: string): string =>
  translate(`auto.components.dashboard.DashboardRunsPanel.${id}`, fallback)

export function DashboardRunsPanel({
  hostId,
  onBack,
  onClose
}: {
  hostId: ExecutionHostId | null
  onBack: () => void
  onClose: () => void
}): React.JSX.Element {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tasks, setTasks] = useState<TaskSummary[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const requestEpoch = useRef(0)
  const target = useMemo(() => (hostId ? runtimeTargetForExecutionHostId(hostId) : null), [hostId])

  useEffect(() => {
    setRuns([])
    setTasks([])
    setSelectedId(null)
    setNextCursor(null)
    setError(null)
    requestEpoch.current += 1
    if (!target) {
      return
    }
    const controller = new AbortController()
    setLoadingRuns(true)
    void callRuntimeRpc<RunPage>(
      target,
      'orchestration.runList',
      { limit: 30 },
      {
        signal: controller.signal
      }
    )
      .then((page) => {
        if (controller.signal.aborted) {
          return
        }
        setRuns(page.runs)
        setNextCursor(page.nextCursor)
        setSelectedId((current) =>
          current && page.runs.some((run) => run.id === current)
            ? current
            : (page.runs[0]?.id ?? null)
        )
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingRuns(false)
        }
      })
    return () => controller.abort()
  }, [target, refreshKey])

  useEffect(() => {
    setTasks([])
    setTaskError(null)
    if (!target || !selectedId) {
      return
    }
    const controller = new AbortController()
    setLoadingTasks(true)
    void callRuntimeRpc<TaskPage>(
      target,
      'orchestration.taskList',
      { run: selectedId, brief: true },
      {
        signal: controller.signal
      }
    )
      .then((page) => {
        if (!controller.signal.aborted) {
          setTasks(page.tasks)
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setTaskError(cause instanceof Error ? cause.message : String(cause))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingTasks(false)
        }
      })
    return () => controller.abort()
  }, [target, selectedId, refreshKey])

  const loadMore = async (): Promise<void> => {
    if (!target || !nextCursor || loadingMore) {
      return
    }
    const epoch = requestEpoch.current
    setLoadingMore(true)
    try {
      const page = await callRuntimeRpc<RunPage>(target, 'orchestration.runList', {
        limit: 30,
        cursor: nextCursor
      })
      if (epoch !== requestEpoch.current) {
        return
      }
      setRuns((current) => [...current, ...page.runs])
      setNextCursor(page.nextCursor)
      setError(null)
    } catch (cause) {
      if (epoch === requestEpoch.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (epoch === requestEpoch.current) {
        setLoadingMore(false)
      }
    }
  }

  const selectedRun = runs.find((run) => run.id === selectedId)
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <Button variant="ghost" size="xs" onClick={onBack}>
          <ArrowLeft className="size-3.5" /> {T('agents', 'Agents')}
        </Button>
        <h1 className="text-[13px] font-semibold">{T('runs', 'Runs')}</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={T('refresh', 'Refresh runs')}
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={!target || loadingRuns}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={T('close', 'Close dashboard')}
            onClick={onClose}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>
      {!hostId ? (
        <p className="p-4 text-sm text-muted-foreground">
          {T(
            'unresolved',
            'The active workspace host is still loading. Open a workspace and try again.'
          )}
        </p>
      ) : !target ? (
        <p className="p-4 text-sm text-muted-foreground">
          {T(
            'sshUnavailable',
            'Direct SSH workspaces do not expose the run ledger here. Open the coordinator terminal to inspect runs on that host.'
          )}
        </p>
      ) : (
        <div className="flex min-h-0 flex-1">
          <section
            className="scrollbar-sleek flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border p-3"
            aria-label={T('runList', 'Run list')}
          >
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
              {T('recentRuns', 'Recent runs')}
            </p>
            {loadingRuns && runs.length === 0 ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {T('loading', 'Loading runs…')}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mb-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}
            {!loadingRuns && !error && runs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {T('empty', 'No runs on this host yet. Start one from a coordinator terminal.')}
              </p>
            ) : null}
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                data-current={run.id === selectedId}
                onClick={() => setSelectedId(run.id)}
                className="mb-1 rounded-md px-2 py-2 text-left hover:bg-accent data-[current=true]:bg-accent"
              >
                <span className="block truncate text-[13px] font-medium">{run.objective}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">
                  {run.id}
                </span>
              </button>
            ))}
            {nextCursor ? (
              <Button
                variant="ghost"
                size="xs"
                className="self-start"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {T('more', 'Load more')}
              </Button>
            ) : null}
          </section>
          <section
            className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto p-4"
            aria-label={T('taskList', 'Task list')}
          >
            {selectedRun ? (
              <>
                <h2 className="text-sm font-semibold">{selectedRun.objective}</h2>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{selectedRun.id}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {T(
                    'coordinatorAction',
                    'Create and assign tasks from the coordinator terminal. Open its agent card in the Agents view.'
                  )}
                </p>
                <h3 className="mt-6 mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  {T('tasks', 'Tasks')}
                </h3>
                {loadingTasks ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {T('loadingTasks', 'Loading tasks…')}
                  </p>
                ) : null}
                {taskError ? (
                  <p role="alert" className="text-xs text-destructive">
                    {taskError}
                  </p>
                ) : null}
                {!loadingTasks && !taskError && tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {T('noTasks', 'No tasks in this run yet.')}
                  </p>
                ) : null}
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <article key={task.id} className="rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-[13px] font-medium">
                          {task.task_title || task.display_name || task.spec}
                        </h4>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {task.status}
                        </span>
                      </div>
                      {task.task_title || task.display_name ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {task.spec}
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
              </>
            ) : !loadingRuns ? (
              <p className="text-sm text-muted-foreground">
                {T('chooseRun', 'Select a run to see its tasks.')}
              </p>
            ) : null}
          </section>
        </div>
      )}
    </div>
  )
}
