import type { RefreshCurrentKoluxProfileAuthResult } from '../../shared/kolux-profiles'
import { getKoluxCloudAuthConfig, isKoluxCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { getKoluxProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { refreshKoluxCloudCapabilities } from './profile-cloud-client'
import { linkKoluxProfileToCloud } from './profile-cloud-index'
import { ensureActiveKoluxProfile, getKoluxProfileListState } from './profile-index-store'
import { refreshDevKoluxCloudProfile } from './profile-cloud-dev-service'
import {
  captureCloudSessionMutation,
  cloudSessionIdentity,
  recordCloudSessionIdentityMutationIfCurrent
} from './profile-cloud-session-mutation'
import { runWithFreshKoluxCloudSession } from './profile-cloud-session-refresh'
import {
  readKoluxCloudSession,
  saveKoluxCloudSessionIfCurrent
} from './profile-cloud-session-store'

export async function refreshCurrentKoluxProfileAuth(
  userDataPath: string
): Promise<RefreshCurrentKoluxProfileAuthResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  const auth = () => getKoluxProfileAuthStatusFromProfile(active, userDataPath)
  if (!active.profile.cloud) {
    return { status: 'local', auth: auth() }
  }
  if (isKoluxCloudDevAuthEnabled()) {
    const result = refreshDevKoluxCloudProfile(active, userDataPath)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: auth() }
    }
    return {
      status: 'refreshed',
      auth: auth(),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }
  const configState = getKoluxCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: auth() }
  }
  try {
    const identity = cloudSessionIdentity(active.profile.id, active.profile.cloud)
    let mutationSnapshot = captureCloudSessionMutation(identity, userDataPath)
    const operation = await runWithFreshKoluxCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => refreshKoluxCloudCapabilities(configState.config, session)
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required', auth: auth() }
    }
    const refresh = operation.value
    if (refresh.cloud) {
      const refreshedIdentity = cloudSessionIdentity(active.profile.id, refresh.cloud)
      if (
        refreshedIdentity.cloudUserId !== identity.cloudUserId ||
        refreshedIdentity.cloudProfileId !== identity.cloudProfileId
      ) {
        throw new Error('kolux_cloud_identity_changed_during_capability_refresh')
      }
      if (refreshedIdentity.organizationId !== identity.organizationId) {
        const advanced = recordCloudSessionIdentityMutationIfCurrent(
          refreshedIdentity,
          userDataPath,
          mutationSnapshot
        )
        if (!advanced) {
          return { status: 'reconnect-required', auth: auth() }
        }
        mutationSnapshot = advanced
      }
    }
    const session = readKoluxCloudSession(active.profile.id, userDataPath)
    if (session.status !== 'found') {
      return { status: 'reconnect-required', auth: auth() }
    }
    if (
      saveKoluxCloudSessionIfCurrent(
        active.profile.id,
        userDataPath,
        {
          ...session.session,
          organizations: refresh.organizations ?? session.session.organizations,
          capabilities: refresh.capabilities
        },
        mutationSnapshot
      ) === null
    ) {
      return { status: 'reconnect-required', auth: auth() }
    }
    const list = refresh.cloud
      ? linkKoluxProfileToCloud(active.profile.id, refresh.cloud, userDataPath)
      : getKoluxProfileListState(userDataPath)
    return {
      status: 'refreshed',
      auth: getKoluxProfileAuthStatusFromProfile(
        ensureActiveKoluxProfile(userDataPath),
        userDataPath
      ),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: auth(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
