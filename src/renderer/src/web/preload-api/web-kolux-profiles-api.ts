import type { PreloadApi } from '../../../../preload/api-types'
import {
  DEFAULT_LOCAL_KOLUX_PROFILE_ID,
  createDefaultLocalKoluxProfile
} from '../../../../shared/kolux-profiles'
import { noopUnsubscribe } from './web-storage'

export function createWebKoluxProfilesApi(): Partial<PreloadApi> {
  const webKoluxProfileAuthStatus = () =>
    Promise.resolve({
      activeProfileId: DEFAULT_LOCAL_KOLUX_PROFILE_ID,
      configured: false,
      state: 'unconfigured' as const,
      persistence: 'none' as const,
      setupMessage: 'Kolux Cloud sign-in is not available in the browser fallback.'
    })
  return {
    koluxProfiles: {
      list: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_KOLUX_PROFILE_ID,
          profiles: [createDefaultLocalKoluxProfile(0)],
          multiProfileUi: false
        }),
      authStatus: webKoluxProfileAuthStatus,
      onAuthStatusChanged: () => noopUnsubscribe,
      createLocal: () =>
        Promise.resolve({
          activeProfileId: DEFAULT_LOCAL_KOLUX_PROFILE_ID,
          profiles: [createDefaultLocalKoluxProfile(0)],
          profile: createDefaultLocalKoluxProfile(0)
        }),
      createCloudLinked: async () => ({
        status: 'unconfigured',
        auth: await webKoluxProfileAuthStatus()
      }),
      switchProfile: () => Promise.resolve({ status: 'already-active' }),
      transferProject: (args) =>
        Promise.resolve({
          status: 'duplicate-target',
          sourceProfileId: args.sourceProfileId,
          targetProfileId: args.targetProfileId,
          sourceRepoId: args.repoId,
          duplicateRepoId: args.repoId
        }),
      findProjectProfiles: async () => ({ projects: [] }),
      connectCurrent: async () => ({
        status: 'unconfigured',
        auth: await webKoluxProfileAuthStatus()
      }),
      refreshAuth: async () => ({
        status: 'unconfigured',
        auth: await webKoluxProfileAuthStatus()
      }),
      signOutCurrent: async () => ({
        status: 'signed-out',
        auth: await webKoluxProfileAuthStatus(),
        activeProfileId: DEFAULT_LOCAL_KOLUX_PROFILE_ID,
        profiles: [createDefaultLocalKoluxProfile(0)]
      }),
      selectOrg: async () => ({
        status: 'unconfigured',
        auth: await webKoluxProfileAuthStatus()
      }),
      orgMembersList: async () => ({ status: 'unconfigured' }),
      orgMemberInvite: async () => ({ status: 'unconfigured' }),
      orgInviteRevoke: async () => ({ status: 'unconfigured' }),
      orgMemberChangeRole: async () => ({ status: 'unconfigured' }),
      orgMemberRemove: async () => ({ status: 'unconfigured' })
    }
  }
}
