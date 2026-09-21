export const KOLUX_RUNTIME_RPC_FEATURE_INTERACTION_SOURCE_KEY = '__koluxFeatureInteractionSource'

export const KOLUX_RUNTIME_RPC_BROWSER_UI_SOURCE = 'browser-pane-ui'

export function withBrowserPaneUiRuntimeRpcSource(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      [KOLUX_RUNTIME_RPC_FEATURE_INTERACTION_SOURCE_KEY]: KOLUX_RUNTIME_RPC_BROWSER_UI_SOURCE
    }
  }
  return {
    ...value,
    [KOLUX_RUNTIME_RPC_FEATURE_INTERACTION_SOURCE_KEY]: KOLUX_RUNTIME_RPC_BROWSER_UI_SOURCE
  }
}

export function isBrowserPaneUiRuntimeRpcParams(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>)[KOLUX_RUNTIME_RPC_FEATURE_INTERACTION_SOURCE_KEY] ===
      KOLUX_RUNTIME_RPC_BROWSER_UI_SOURCE
  )
}
