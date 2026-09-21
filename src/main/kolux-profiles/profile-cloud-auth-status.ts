import type { KoluxProfileAuthStatus } from '../../shared/kolux-profiles'
import type { ActiveKoluxProfileState } from './profile-index-store'
import { getKoluxCloudAuthConfig, isKoluxCloudDevAuthEnabled } from './profile-cloud-auth-config'
import { readKoluxCloudSession } from './profile-cloud-session-store'

export function getKoluxProfileAuthStatusFromProfile(
  active: ActiveKoluxProfileState,
  userDataPath: string
): KoluxProfileAuthStatus {
  const configState = getKoluxCloudAuthConfig()
  const devAuthEnabled = isKoluxCloudDevAuthEnabled()
  const configured = configState.configured || devAuthEnabled
  const cloud = active.profile.cloud
  if (!cloud) {
    return {
      activeProfileId: active.profile.id,
      configured,
      state: configured ? 'local' : 'unconfigured',
      persistence: 'none',
      setupMessage: configured ? undefined : configState.setupMessage
    }
  }

  const session = readKoluxCloudSession(active.profile.id, userDataPath)
  if (!configured) {
    return {
      activeProfileId: active.profile.id,
      configured: false,
      state: 'unconfigured',
      persistence: session.status === 'found' ? session.persistence : 'none',
      cloud,
      credentialError:
        session.status === 'decrypt-failed' || session.status === 'unreadable'
          ? session.error
          : undefined,
      setupMessage: configState.setupMessage
    }
  }
  if (session.status === 'found') {
    return {
      activeProfileId: active.profile.id,
      configured,
      state: 'connected',
      persistence: session.persistence,
      cloud,
      organizations: session.session.organizations,
      capabilities: session.session.capabilities
    }
  }

  return {
    activeProfileId: active.profile.id,
    configured,
    state: 'reconnect-required',
    persistence: 'none',
    cloud,
    credentialError:
      session.status === 'decrypt-failed' || session.status === 'unreadable'
        ? session.error
        : undefined
  }
}
