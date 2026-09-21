import { app, ipcMain } from 'electron'
import type { Store } from '../persistence'
import { relaunchApp, type AppRelaunchReason } from '../app-relaunch'
import type {
  CreateLocalKoluxProfileArgs,
  CreateLocalKoluxProfileResult,
  CreateCloudLinkedKoluxProfileArgs,
  CreateCloudLinkedKoluxProfileResult,
  FindKoluxProfileProjectsByPathArgs,
  FindKoluxProfileProjectsByPathResult,
  KoluxProfileListResult,
  RefreshCurrentKoluxProfileAuthResult,
  SwitchKoluxProfileArgs,
  SwitchKoluxProfileResult,
  TransferKoluxProfileProjectArgs,
  TransferKoluxProfileProjectResult,
  ConnectCurrentKoluxProfileResult,
  KoluxProfileAuthStatus,
  SelectKoluxProfileOrgArgs,
  SelectKoluxProfileOrgResult,
  SignOutCurrentKoluxProfileResult
} from '../../shared/kolux-profiles'
import {
  createLocalKoluxProfile,
  getKoluxProfileListState,
  seedNewKoluxProfileTelemetryConsent,
  setActiveKoluxProfile
} from '../kolux-profiles/profile-index-store'
import {
  cloudSessionIdentity,
  recordCloudSessionIdentityMutation
} from '../kolux-profiles/profile-cloud-session-mutation'
import { getProfileUserDataPath } from '../kolux-profiles/profile-storage-paths'
import { isMultiProfileUiEnabled } from '../kolux-profiles/profile-ui-scope'
import { transferKoluxProfileProject } from '../kolux-profiles/profile-project-transfer'
import { findKoluxProfileProjectsByPath } from '../kolux-profiles/profile-project-presence'
import { flushActiveProfileBeforeFileMutation } from '../kolux-profiles/profile-persistence-deadline'
import {
  createCloudLinkedProfileArgsFromUnknown,
  findProjectsByPathArgsFromUnknown,
  orgIdFromUnknown,
  profileIdFromArgs,
  transferProjectArgsFromUnknown
} from './kolux-profile-handler-args'
import {
  createCloudLinkedKoluxProfile,
  connectCurrentKoluxProfile,
  getCurrentKoluxProfileAuthStatus,
  refreshCurrentKoluxProfileAuth,
  selectCurrentKoluxProfileOrg,
  signOutCurrentKoluxProfile
} from '../kolux-profiles/profile-cloud-service'
import { registerKoluxProfileOrgMemberHandlers } from './kolux-profile-org-members-handlers'
import { onKoluxCloudSessionInvalidated } from '../kolux-profiles/profile-cloud-session-invalidation'
import { broadcastKoluxProfileAuthStatusChanged } from './kolux-profile-auth-status-broadcast'

type RegisterKoluxProfileHandlersOptions = {
  onBeforeRelaunch?: () => void | Promise<void>
  onAuthMutation?: () => void
  onBeforeSignOut?: () => void
}

async function runBeforeProfileRelaunch(
  onBeforeRelaunch?: () => void | Promise<void>
): Promise<void> {
  try {
    await onBeforeRelaunch?.()
  } catch (error) {
    console.warn(
      '[kolux-profiles] Pre-relaunch cleanup failed; continuing profile switch:',
      error instanceof Error ? error.name : typeof error
    )
  }
}

function scheduleProfileRelaunch(reason: Extract<AppRelaunchReason, `profile-${string}`>): void {
  setTimeout(() => {
    relaunchApp(reason)
    // Why: app.quit() (not app.exit) so before-quit/will-quit still run —
    // renderer scrollback capture, PTY kill, stats flush, and daemon final
    // checkpoints must not be skipped on a profile switch.
    app.quit()
  }, 150)
}

export function registerKoluxProfileHandlers(
  store: Store,
  options: RegisterKoluxProfileHandlersOptions = {}
): void {
  ipcMain.handle('koluxProfiles:list', (): KoluxProfileListResult => ({
    ...getKoluxProfileListState(),
    multiProfileUi: isMultiProfileUiEnabled()
  }))

  ipcMain.handle('koluxProfiles:authStatus', (): KoluxProfileAuthStatus =>
    getCurrentKoluxProfileAuthStatus(getProfileUserDataPath())
  )

  // Why: a background refresh can revoke the session with no renderer request in
  // flight, so push the change instead of waiting for the next pane to ask.
  // Why not options.onAuthMutation: that hook drives the relay coordinator, which
  // is the caller that just failed the refresh — re-entering it here would be a loop.
  onKoluxCloudSessionInvalidated(broadcastKoluxProfileAuthStatusChanged)

  ipcMain.handle(
    'koluxProfiles:createLocal',
    (_event, args?: CreateLocalKoluxProfileArgs): CreateLocalKoluxProfileResult => {
      const result = createLocalKoluxProfile(args)
      seedNewKoluxProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
      return result
    }
  )

  ipcMain.handle(
    'koluxProfiles:switch',
    async (_event, args: SwitchKoluxProfileArgs): Promise<SwitchKoluxProfileResult> => {
      const profileId = profileIdFromArgs(args)
      const current = getKoluxProfileListState()
      if (profileId === current.activeProfileId) {
        return { status: 'already-active' }
      }

      const activeProfile = current.profiles.find(
        (profile) => profile.id === current.activeProfileId
      )
      if (activeProfile?.cloud) {
        // Why: profile selection changes the expected identity synchronously;
        // stale refresh saves must fail even before relaunch teardown finishes.
        recordCloudSessionIdentityMutation(
          cloudSessionIdentity(activeProfile.id, activeProfile.cloud),
          getProfileUserDataPath()
        )
      }
      // Why: the current profile must be persisted before the global index
      // points startup at the target profile.
      await flushActiveProfileBeforeFileMutation(store)
      await runBeforeProfileRelaunch(options.onBeforeRelaunch)
      setActiveKoluxProfile(profileId)

      scheduleProfileRelaunch('profile-switch')

      return { status: 'relaunching' }
    }
  )

  ipcMain.handle(
    'koluxProfiles:transferProject',
    async (
      _event,
      rawArgs: TransferKoluxProfileProjectArgs
    ): Promise<TransferKoluxProfileProjectResult> => {
      const args = transferProjectArgsFromUnknown(rawArgs)
      const current = getKoluxProfileListState()
      if (args.targetProfileId === current.activeProfileId) {
        throw new Error('active_target_kolux_profile_transfer_requires_relaunch')
      }
      if (args.mode === 'move' && args.sourceProfileId === current.activeProfileId) {
        // Why: transfer before any relaunch side effect so a duplicate-target
        // or validation failure cannot strand the app in a quitting state.
        await flushActiveProfileBeforeFileMutation(store)
        const result = transferKoluxProfileProject(args, getProfileUserDataPath())
        if (result.status === 'transferred') {
          store.freezeWrites()
          await runBeforeProfileRelaunch(options.onBeforeRelaunch)
          setActiveKoluxProfile(args.targetProfileId)
          scheduleProfileRelaunch('profile-transfer')
          return { ...result, willRelaunch: true }
        }
        return result
      }
      await flushActiveProfileBeforeFileMutation(store)
      return transferKoluxProfileProject(args, getProfileUserDataPath())
    }
  )

  ipcMain.handle(
    'koluxProfiles:findProjectProfiles',
    (_event, rawArgs: FindKoluxProfileProjectsByPathArgs): FindKoluxProfileProjectsByPathResult =>
      findKoluxProfileProjectsByPath(
        findProjectsByPathArgsFromUnknown(rawArgs),
        getProfileUserDataPath()
      )
  )

  ipcMain.handle(
    'koluxProfiles:connectCurrent',
    async (): Promise<ConnectCurrentKoluxProfileResult> => {
      const result = await connectCurrentKoluxProfile(getProfileUserDataPath())
      if (result.status === 'connected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'koluxProfiles:createCloudLinked',
    async (
      _event,
      rawArgs?: CreateCloudLinkedKoluxProfileArgs
    ): Promise<CreateCloudLinkedKoluxProfileResult> => {
      const result = await createCloudLinkedKoluxProfile(
        getProfileUserDataPath(),
        createCloudLinkedProfileArgsFromUnknown(rawArgs)
      )
      if (result.status === 'created') {
        seedNewKoluxProfileTelemetryConsent(result.profile.id, store.getSettings().telemetry)
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'koluxProfiles:refreshAuth',
    async (): Promise<RefreshCurrentKoluxProfileAuthResult> => {
      const result = await refreshCurrentKoluxProfileAuth(getProfileUserDataPath())
      if (result.status === 'refreshed') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  ipcMain.handle(
    'koluxProfiles:signOutCurrent',
    async (): Promise<SignOutCurrentKoluxProfileResult> => {
      options.onBeforeSignOut?.()
      return signOutCurrentKoluxProfile(getProfileUserDataPath())
    }
  )

  ipcMain.handle(
    'koluxProfiles:selectOrg',
    async (_event, rawArgs: SelectKoluxProfileOrgArgs): Promise<SelectKoluxProfileOrgResult> => {
      const result = await selectCurrentKoluxProfileOrg(
        getProfileUserDataPath(),
        orgIdFromUnknown(rawArgs)
      )
      if (result.status === 'selected') {
        options.onAuthMutation?.()
      }
      return result
    }
  )

  registerKoluxProfileOrgMemberHandlers()
}
