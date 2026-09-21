import type { KoluxCloudAuthConfig } from './profile-cloud-auth-config'
import {
  KoluxCloudRequestError,
  refreshKoluxCloudSession,
  selectKoluxCloudOrg
} from './profile-cloud-client'
import { linkKoluxProfileToCloud } from './profile-cloud-index'
import type { ActiveKoluxProfileState } from './profile-index-store'
import {
  cloudSessionIdentity,
  recordCloudSessionIdentityMutation,
  recordCloudSessionIdentityMutationIfCurrent
} from './profile-cloud-session-mutation'
import {
  readKoluxCloudSession,
  saveKoluxCloudSessionIfCurrent,
  type KoluxCloudSession
} from './profile-cloud-session-store'

export async function selectCloudOrgWithMutationFence(input: {
  config: KoluxCloudAuthConfig
  active: ActiveKoluxProfileState
  userDataPath: string
  orgId: string
}): Promise<ReturnType<typeof linkKoluxProfileToCloud> | null> {
  const cloud = input.active.profile.cloud
  const stored = readKoluxCloudSession(input.active.profile.id, input.userDataPath)
  if (!cloud || stored.status !== 'found') {
    return null
  }
  const oldIdentity = cloudSessionIdentity(input.active.profile.id, cloud)
  const targetIdentity = {
    ...oldIdentity,
    organizationId: input.orgId
  }
  // Why: advance the durable identity fence before the first request. An old
  // refresh may finish, but its compare-and-save can no longer publish.
  const snapshot = recordCloudSessionIdentityMutation(targetIdentity, input.userDataPath)
  let workingSession: KoluxCloudSession = stored.session
  try {
    let selected
    try {
      selected = await selectKoluxCloudOrg(input.config, workingSession, input.orgId)
    } catch (error) {
      if (!(error instanceof KoluxCloudRequestError) || error.statusCode !== 401) {
        throw error
      }
      const refreshed = await refreshKoluxCloudSession(input.config, workingSession)
      if (
        refreshed.cloud.userId !== cloud.userId ||
        refreshed.cloud.cloudProfileId !== cloud.cloudProfileId
      ) {
        throw new Error('kolux_cloud_identity_changed_during_org_selection')
      }
      workingSession = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: refreshed.expiresAt,
        organizations: refreshed.organizations,
        capabilities: refreshed.capabilities
      }
      selected = await selectKoluxCloudOrg(input.config, workingSession, input.orgId)
    }
    if (
      selected.cloud.userId !== cloud.userId ||
      selected.cloud.cloudProfileId !== cloud.cloudProfileId ||
      selected.cloud.activeOrgId !== input.orgId
    ) {
      throw new Error('kolux_cloud_org_selection_identity_mismatch')
    }
    const nextSession: KoluxCloudSession = {
      ...workingSession,
      organizations: selected.organizations ?? workingSession.organizations,
      capabilities: selected.capabilities
    }
    if (
      saveKoluxCloudSessionIfCurrent(
        input.active.profile.id,
        input.userDataPath,
        nextSession,
        snapshot
      ) === null
    ) {
      throw new Error('stale_cloud_session_mutation')
    }
    const list = linkKoluxProfileToCloud(
      input.active.profile.id,
      selected.cloud,
      input.userDataPath
    )
    return list
  } catch (error) {
    recordCloudSessionIdentityMutationIfCurrent(oldIdentity, input.userDataPath, snapshot)
    throw error
  }
}
