import { getStatusPluginEndpointSource } from './status-plugin-endpoint-source'
import { getStatusPluginRuntimeStateSource } from './status-plugin-runtime-state-source'
import { getStatusPluginMessagePreviewSource } from './status-plugin-message-preview-source'
import { getStatusPluginSessionLineageSource } from './status-plugin-session-lineage-source'
import { getStatusPluginPostSource } from './status-plugin-post-source'
import { getStatusPluginDeliverySource } from './status-plugin-delivery-source'
import { getStatusPluginOwnershipSource } from './status-plugin-ownership-source'
import { getStatusPluginLifecycleSource } from './status-plugin-lifecycle-source'
import { getStatusPluginFactorySource } from './status-plugin-factory-source'

// Why: the plugin posts PTY environment data from MiMo Code to the shared hooks server.
export function getMimoCodePluginSource(
  hookPathname: string,
  options: { emitSessionStart: boolean }
): string {
  return [
    ...getStatusPluginEndpointSource(),
    ...getStatusPluginRuntimeStateSource(),
    ...getStatusPluginMessagePreviewSource(),
    ...getStatusPluginSessionLineageSource(),
    ...getStatusPluginPostSource(hookPathname),
    ...getStatusPluginDeliverySource(),
    ...getStatusPluginOwnershipSource(),
    ...getStatusPluginLifecycleSource(),
    ...getStatusPluginFactorySource(options)
  ].join('\n')
}

export const _internals = {
  getMimoCodePluginSource
}
