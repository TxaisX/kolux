import type {
  KoluxCloudCapabilities,
  KoluxCloudOrgSummary,
  KoluxProfileCloudSummary
} from '../../shared/kolux-profiles'

export type KoluxCloudSessionExchangeResponse = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloud: KoluxProfileCloudSummary
  organizations?: KoluxCloudOrgSummary[]
  capabilities: KoluxCloudCapabilities
}
