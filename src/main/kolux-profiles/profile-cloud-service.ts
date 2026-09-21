import type {
  ConnectCurrentKoluxProfileResult,
  CreateCloudLinkedKoluxProfileArgs,
  CreateCloudLinkedKoluxProfileResult,
  KoluxProfileAuthStatus,
  SelectKoluxProfileOrgResult,
  SignOutCurrentKoluxProfileResult
} from '../../shared/kolux-profiles'
import { ensureActiveKoluxProfile } from './profile-index-store'
import { getKoluxCloudAuthConfig, isKoluxCloudDevAuthEnabled } from './profile-cloud-auth-config'
import {
  clearKoluxCloudSession,
  readKoluxCloudSession,
  saveKoluxCloudSessionExchange
} from './profile-cloud-session-store'
import { cloudSessionIdentity, tombstoneCloudSession } from './profile-cloud-session-mutation'
import {
  createKoluxCloudProfile,
  exchangeKoluxCloudAuthCode,
  revokeKoluxCloudSession
} from './profile-cloud-client'
import { beginKoluxCloudPkceFlow } from './profile-cloud-pkce'
import {
  createCloudLinkedKoluxProfileRecord,
  linkKoluxProfileToCloud,
  unlinkKoluxProfileFromCloud
} from './profile-cloud-index'
import { runWithFreshKoluxCloudSession } from './profile-cloud-session-refresh'
import {
  connectDevKoluxCloudProfile,
  createDevCloudLinkedKoluxProfile,
  selectDevKoluxCloudOrg
} from './profile-cloud-dev-service'
import { getKoluxProfileAuthStatusFromProfile } from './profile-cloud-auth-status'
import { selectCloudOrgWithMutationFence } from './profile-cloud-org-selection'

export { refreshCurrentKoluxProfileAuth } from './profile-cloud-capability-refresh'

function isUserCancelledAuthError(message: string): boolean {
  return message === 'kolux_cloud_auth_timeout' || message === 'kolux_cloud_auth_denied'
}

function activeAuth(
  active: ReturnType<typeof ensureActiveKoluxProfile>,
  userDataPath: string
): KoluxProfileAuthStatus {
  return getKoluxProfileAuthStatusFromProfile(active, userDataPath)
}

export function getCurrentKoluxProfileAuthStatus(userDataPath: string): KoluxProfileAuthStatus {
  return getKoluxProfileAuthStatusFromProfile(ensureActiveKoluxProfile(userDataPath), userDataPath)
}

export async function connectCurrentKoluxProfile(
  userDataPath: string
): Promise<ConnectCurrentKoluxProfileResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  if (isKoluxCloudDevAuthEnabled()) {
    const list = connectDevKoluxCloudProfile(active, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentKoluxProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  }

  const configState = getKoluxCloudAuthConfig()
  if (!configState.configured) {
    return {
      status: 'unconfigured',
      auth: activeAuth(active, userDataPath)
    }
  }

  try {
    const code = await beginKoluxCloudPkceFlow(configState.config, active.profile.id)
    const exchange = await exchangeKoluxCloudAuthCode(configState.config, {
      ...code,
      localProfileId: active.profile.id
    })
    saveKoluxCloudSessionExchange(active.profile.id, userDataPath, exchange)
    const list = linkKoluxProfileToCloud(active.profile.id, exchange.cloud, userDataPath)
    return {
      status: 'connected',
      auth: getCurrentKoluxProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isUserCancelledAuthError(message)) {
      return {
        status: 'cancelled',
        auth: getCurrentKoluxProfileAuthStatus(userDataPath)
      }
    }
    return {
      status: 'failed',
      auth: getCurrentKoluxProfileAuthStatus(userDataPath),
      error: message
    }
  }
}

export async function signOutCurrentKoluxProfile(
  userDataPath: string
): Promise<SignOutCurrentKoluxProfileResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  const configState = getKoluxCloudAuthConfig()
  const session = readKoluxCloudSession(active.profile.id, userDataPath)
  if (active.profile.cloud) {
    // Why: persist the destructive fence before logout network I/O so a
    // refresh already in flight cannot save after explicit sign-out.
    tombstoneCloudSession(
      cloudSessionIdentity(active.profile.id, active.profile.cloud),
      userDataPath
    )
  }
  if (!isKoluxCloudDevAuthEnabled() && configState.configured && session.status === 'found') {
    await revokeKoluxCloudSession(configState.config, session.session).catch(() => undefined)
  }
  clearKoluxCloudSession(active.profile.id, userDataPath)
  const list = unlinkKoluxProfileFromCloud(active.profile.id, userDataPath)
  return {
    status: 'signed-out',
    auth: getCurrentKoluxProfileAuthStatus(userDataPath),
    activeProfileId: list.activeProfileId,
    profiles: list.profiles
  }
}

export async function createCloudLinkedKoluxProfile(
  userDataPath: string,
  args: CreateCloudLinkedKoluxProfileArgs
): Promise<CreateCloudLinkedKoluxProfileResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  if (isKoluxCloudDevAuthEnabled()) {
    const result = createDevCloudLinkedKoluxProfile(active, userDataPath, args)
    if (result.status !== 'created') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'created',
      auth: getCurrentKoluxProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles,
      profile: result.list.profile
    }
  }

  const configState = getKoluxCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const operation = await runWithFreshKoluxCloudSession(
      configState.config,
      active,
      userDataPath,
      (session) => createKoluxCloudProfile(configState.config, session, args)
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    const created = operation.value
    const list = createCloudLinkedKoluxProfileRecord(
      created.cloud,
      { name: args.name },
      userDataPath
    )
    saveKoluxCloudSessionExchange(list.profile.id, userDataPath, created)
    return {
      status: 'created',
      auth: getCurrentKoluxProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles,
      profile: list.profile
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentKoluxProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function selectCurrentKoluxProfileOrg(
  userDataPath: string,
  orgId: string
): Promise<SelectKoluxProfileOrgResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  if (isKoluxCloudDevAuthEnabled()) {
    const result = selectDevKoluxCloudOrg(active, userDataPath, orgId)
    if (result.status !== 'updated') {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentKoluxProfileAuthStatus(userDataPath),
      activeProfileId: result.list.activeProfileId,
      profiles: result.list.profiles
    }
  }

  const configState = getKoluxCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured', auth: activeAuth(active, userDataPath) }
  }
  try {
    const list = await selectCloudOrgWithMutationFence({
      config: configState.config,
      active,
      userDataPath,
      orgId
    })
    if (!list) {
      return { status: 'reconnect-required', auth: activeAuth(active, userDataPath) }
    }
    return {
      status: 'selected',
      auth: getCurrentKoluxProfileAuthStatus(userDataPath),
      activeProfileId: list.activeProfileId,
      profiles: list.profiles
    }
  } catch (error) {
    return {
      status: 'failed',
      auth: getCurrentKoluxProfileAuthStatus(userDataPath),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
