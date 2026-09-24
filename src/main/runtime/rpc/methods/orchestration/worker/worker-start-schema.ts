import { z } from 'zod'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../../../schemas'
import { ORCHESTRATION_ROUTING_TIERS } from '../../../../../../shared/orchestration-routing-tiers'

export const OptionalWorkerLaunchPreference = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => value === value.trim(), 'Surrounding whitespace is invalid')
  .optional()

export const WorkerStartParams = z
  .object({
    task: OptionalString,
    spec: OptionalString,
    taskTitle: OptionalString,
    deps: OptionalString,
    parent: OptionalString,
    on: OptionalString,
    run: OptionalString,
    from: requiredString('Missing --from'),
    worktree: OptionalString,
    name: OptionalString,
    repo: OptionalString,
    baseBranch: OptionalString,
    displayName: OptionalString,
    comment: OptionalString,
    setup: z.enum(['run', 'skip', 'inherit']).optional(),
    terminal: OptionalString,
    agent: OptionalString,
    model: OptionalWorkerLaunchPreference,
    effort: OptionalWorkerLaunchPreference,
    retryOf: OptionalString,
    timeoutMs: OptionalFiniteNumber,
    devMode: z.boolean().optional(),
    tier: z.enum(ORCHESTRATION_ROUTING_TIERS).optional()
  })
  .superRefine((params, ctx) => {
    if (!params.task && !params.spec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['task'],
        message: 'Missing --task or --spec'
      })
    }
    if (params.task && params.spec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['spec'],
        message: '--task and --spec are mutually exclusive'
      })
    }
    // Why: --tier resolves model/effort itself, and --terminal reuses a pane whose agent
    // --tier cannot renegotiate, so both would conflict silently rather than telling the
    // caller which one wins. --agent stays allowed: it only narrows --tier to the
    // coordinator's own provider (enforced at request time, where the coordinator's agent
    // is known) or names one when the coordinator's agent cannot be detected.
    if (params.tier && (params.model || params.effort || params.terminal)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tier'],
        message: '--tier cannot combine with --model, --effort, or --terminal'
      })
    }
    // Why: --spec creates a new Task, so a retry link to a prior Dispatch could never resolve and
    // the refusal named a Task id the caller never supplied.
    if (params.retryOf && params.spec) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['retryOf'],
        message:
          '--retry-of needs --task <task_id> naming the failed Task; --spec creates a new one'
      })
    }
  })

export type WorkerStartInput = z.infer<typeof WorkerStartParams>
