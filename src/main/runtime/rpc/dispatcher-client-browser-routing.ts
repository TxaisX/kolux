import type { KoluxRuntimeService } from '../kolux-runtime'

export function routeDispatcherClientHostedBrowserRpc(
  runtime: KoluxRuntimeService,
  method: string,
  params: unknown
) {
  const candidate = runtime as KoluxRuntimeService & {
    routeClientHostedBrowserRpc?: KoluxRuntimeService['routeClientHostedBrowserRpc']
  }
  return candidate.routeClientHostedBrowserRpc?.(method, params) ?? { handled: false as const }
}
