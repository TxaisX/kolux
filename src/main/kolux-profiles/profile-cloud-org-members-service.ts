import type {
  KoluxProfileOrgInviteRevokeArgs,
  KoluxProfileOrgMemberChangeRoleArgs,
  KoluxProfileOrgMemberInviteArgs,
  KoluxProfileOrgMemberMutationResult,
  KoluxProfileOrgMemberRemoveArgs,
  KoluxProfileOrgMembersListResult
} from '../../shared/kolux-profiles'
import type { ActiveKoluxProfileState } from './profile-index-store'
import { ensureActiveKoluxProfile } from './profile-index-store'
import type { KoluxCloudAuthConfig } from './profile-cloud-auth-config'
import { getKoluxCloudAuthConfig, isKoluxCloudDevAuthEnabled } from './profile-cloud-auth-config'
import type { KoluxCloudSession } from './profile-cloud-session-store'
import { KoluxCloudRequestError } from './profile-cloud-client'
import { runWithFreshKoluxCloudSession } from './profile-cloud-session-refresh'
import {
  changeKoluxCloudOrgMemberRole,
  inviteKoluxCloudOrgMember,
  listKoluxCloudOrgMembers,
  removeKoluxCloudOrgMember,
  revokeKoluxCloudOrgInvite
} from './profile-cloud-org-members-client'
import {
  changeDevKoluxCloudOrgMemberRole,
  inviteDevKoluxCloudOrgMember,
  listDevKoluxCloudOrgMembers,
  removeDevKoluxCloudOrgMember,
  revokeDevKoluxCloudOrgInvite
} from './profile-cloud-dev-org-members'

type OrgCallResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'reconnect-required' }
  | { status: 'request-error'; error: KoluxCloudRequestError }
  | { status: 'failed'; error: string }

// Why: only a 401 means the token itself is stale and should drive a session
// refresh/reconnect. 403/404/409/400 are business or permission outcomes the UI
// must interpret, so they are surfaced as values rather than thrown — otherwise
// runWithFreshKoluxCloudSession would treat a 403 as an auth failure and burn a
// pointless token refresh + retry before giving up.
async function runOrgMemberCall<T>(
  config: KoluxCloudAuthConfig,
  active: ActiveKoluxProfileState,
  userDataPath: string,
  call: (session: KoluxCloudSession) => Promise<T>
): Promise<OrgCallResult<T>> {
  try {
    const operation = await runWithFreshKoluxCloudSession(
      config,
      active,
      userDataPath,
      async (session) => {
        try {
          return { ok: true as const, value: await call(session) }
        } catch (error) {
          if (error instanceof KoluxCloudRequestError && error.statusCode !== 401) {
            return { ok: false as const, error }
          }
          throw error
        }
      }
    )
    if (operation.status !== 'ok') {
      return { status: 'reconnect-required' }
    }
    const outcome = operation.value
    return outcome.ok
      ? { status: 'ok', value: outcome.value }
      : { status: 'request-error', error: outcome.error }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

function mapMutationRequestError(
  error: KoluxCloudRequestError
): KoluxProfileOrgMemberMutationResult {
  switch (error.statusCode) {
    case 403:
      return { status: 'forbidden' }
    case 404:
      return { status: 'not-found' }
    case 409:
      return {
        status: 'conflict',
        reason: error.errorCode === 'already_member' ? 'already_member' : 'already_invited'
      }
    case 400:
      return {
        status: 'invalid',
        reason:
          error.errorCode === 'cannot_remove_self' ? 'cannot_remove_self' : 'cannot_change_own_role'
      }
    default:
      return { status: 'failed', error: error.message }
  }
}

function mapMutationResult(result: OrgCallResult<void>): KoluxProfileOrgMemberMutationResult {
  switch (result.status) {
    case 'ok':
      return { status: 'ok' }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return mapMutationRequestError(result.error)
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function listKoluxProfileOrgMembers(
  userDataPath: string,
  orgId: string
): Promise<KoluxProfileOrgMembersListResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  if (isKoluxCloudDevAuthEnabled()) {
    return { status: 'ok', roster: listDevKoluxCloudOrgMembers(orgId) }
  }
  const configState = getKoluxCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  const result = await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
    listKoluxCloudOrgMembers(configState.config, session, orgId)
  )
  switch (result.status) {
    case 'ok':
      return { status: 'ok', roster: result.value }
    case 'reconnect-required':
      return { status: 'reconnect-required' }
    case 'request-error':
      return { status: 'failed', error: result.error.message }
    case 'failed':
      return { status: 'failed', error: result.error }
  }
}

export async function inviteKoluxProfileOrgMember(
  userDataPath: string,
  args: KoluxProfileOrgMemberInviteArgs
): Promise<KoluxProfileOrgMemberMutationResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  if (isKoluxCloudDevAuthEnabled()) {
    return inviteDevKoluxCloudOrgMember(args)
  }
  const configState = getKoluxCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      inviteKoluxCloudOrgMember(configState.config, session, args)
    )
  )
}

export async function revokeKoluxProfileOrgInvite(
  userDataPath: string,
  args: KoluxProfileOrgInviteRevokeArgs
): Promise<KoluxProfileOrgMemberMutationResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  if (isKoluxCloudDevAuthEnabled()) {
    return revokeDevKoluxCloudOrgInvite(args)
  }
  const configState = getKoluxCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      revokeKoluxCloudOrgInvite(configState.config, session, args)
    )
  )
}

export async function changeKoluxProfileOrgMemberRole(
  userDataPath: string,
  args: KoluxProfileOrgMemberChangeRoleArgs
): Promise<KoluxProfileOrgMemberMutationResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  if (isKoluxCloudDevAuthEnabled()) {
    return changeDevKoluxCloudOrgMemberRole(args)
  }
  const configState = getKoluxCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      changeKoluxCloudOrgMemberRole(configState.config, session, args)
    )
  )
}

export async function removeKoluxProfileOrgMember(
  userDataPath: string,
  args: KoluxProfileOrgMemberRemoveArgs
): Promise<KoluxProfileOrgMemberMutationResult> {
  const active = ensureActiveKoluxProfile(userDataPath)
  if (isKoluxCloudDevAuthEnabled()) {
    return removeDevKoluxCloudOrgMember(args)
  }
  const configState = getKoluxCloudAuthConfig()
  if (!configState.configured) {
    return { status: 'unconfigured' }
  }
  return mapMutationResult(
    await runOrgMemberCall(configState.config, active, userDataPath, (session) =>
      removeKoluxCloudOrgMember(configState.config, session, args)
    )
  )
}
