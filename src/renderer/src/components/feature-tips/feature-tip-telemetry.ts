import { track } from '@/lib/telemetry'
import type { EventProps } from '../../../../shared/telemetry-events'

export type KoluxCliFeatureTipSource = EventProps<'kolux_cli_feature_tip_shown'>['source']
export type KoluxCliFeatureTipSetupResult =
  EventProps<'kolux_cli_feature_tip_setup_result'>['result']
export type CmdJPaletteFeatureTipSource = EventProps<'cmd_j_palette_feature_tip_shown'>['source']

export function getKoluxCliFeatureTipTelemetrySource(value: unknown): KoluxCliFeatureTipSource {
  return value === 'app_open' ? 'app_open' : 'manual'
}

export function trackKoluxCliFeatureTipShown(source: KoluxCliFeatureTipSource): void {
  track('kolux_cli_feature_tip_shown', { source })
}

export function trackKoluxCliFeatureTipSetupClicked(source: KoluxCliFeatureTipSource): void {
  track('kolux_cli_feature_tip_setup_clicked', { source })
}

export function trackKoluxCliFeatureTipSetupResult(
  source: KoluxCliFeatureTipSource,
  result: KoluxCliFeatureTipSetupResult
): void {
  track('kolux_cli_feature_tip_setup_result', { source, result })
}

export function trackCmdJPaletteFeatureTipShown(source: CmdJPaletteFeatureTipSource): void {
  track('cmd_j_palette_feature_tip_shown', { source })
}

export function trackCmdJPaletteFeatureTipAcknowledged(source: CmdJPaletteFeatureTipSource): void {
  track('cmd_j_palette_feature_tip_acknowledged', { source })
}
