import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  ConnectCurrentKoluxProfileResult,
  CreateCloudLinkedKoluxProfileResult,
  RefreshCurrentKoluxProfileAuthResult,
  SelectKoluxProfileOrgResult,
  SignOutCurrentKoluxProfileResult
} from '../../../../shared/kolux-profiles'
import type { AppState } from '../types'

export type KoluxProfilesAuthActions = {
  createCloudLinkedKoluxProfile: (args: {
    orgId?: string
    name?: string
  }) => Promise<CreateCloudLinkedKoluxProfileResult | null>
  connectCurrentKoluxProfile: () => Promise<ConnectCurrentKoluxProfileResult | null>
  refreshCurrentKoluxProfileAuth: () => Promise<RefreshCurrentKoluxProfileAuthResult | null>
  signOutCurrentKoluxProfile: () => Promise<SignOutCurrentKoluxProfileResult | null>
  selectKoluxProfileOrg: (orgId: string) => Promise<SelectKoluxProfileOrgResult | null>
}

// Why a separate module: the cloud-auth actions share the profiles slice's
// state keys but form their own cohesive surface (connect/refresh/sign-out/
// org selection), and the combined slice file exceeded the repo line budget.
export const createKoluxProfilesAuthActions: StateCreator<
  AppState,
  [],
  [],
  KoluxProfilesAuthActions
> = (set, get) => ({
  createCloudLinkedKoluxProfile: async (args) => {
    try {
      const result = await window.api.koluxProfiles.createCloudLinked(args)
      set({
        koluxProfileAuthStatus: result.auth,
        ...(result.status === 'created'
          ? {
              activeKoluxProfileId: result.activeProfileId,
              koluxProfiles: result.profiles
            }
          : {})
      })
      if (result.status === 'created') {
        toast.success(
          translate('auto.store.slices.kolux.profiles.319d7cf39b', 'Cloud profile created')
        )
      } else if (result.status === 'reconnect-required') {
        toast.error(
          translate('auto.store.slices.kolux.profiles.d6e764e7db', 'Reconnect this profile')
        )
      } else if (result.status === 'failed') {
        toast.error(
          translate(
            'auto.store.slices.kolux.profiles.f0c9e11a6d',
            'Failed to create cloud profile'
          ),
          { description: result.error }
        )
      }
      return result
    } catch (err) {
      console.error('Failed to create Kolux cloud profile:', err)
      toast.error(
        translate('auto.store.slices.kolux.profiles.f0c9e11a6d', 'Failed to create cloud profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  connectCurrentKoluxProfile: async () => {
    if (get().koluxProfileConnecting) {
      return null
    }
    set({ koluxProfileConnecting: true })
    try {
      const result = await window.api.koluxProfiles.connectCurrent()
      set({
        koluxProfileConnecting: false,
        koluxProfileAuthStatus: result.auth,
        ...(result.status === 'connected'
          ? {
              activeKoluxProfileId: result.activeProfileId,
              koluxProfiles: result.profiles
            }
          : {})
      })
      if (result.status === 'unconfigured') {
        toast.error(
          translate(
            'auto.store.slices.kolux.profiles.8b8fa73174',
            'Kolux Cloud sign-in is not configured'
          ),
          {
            description: result.auth.setupMessage
          }
        )
      } else if (result.status === 'failed') {
        toast.error(
          translate('auto.store.slices.kolux.profiles.33290e88ed', 'Failed to connect profile'),
          { description: result.error }
        )
      } else if (result.status === 'connected') {
        toast.success(translate('auto.store.slices.kolux.profiles.9fcb07a796', 'Profile connected'))
      }
      return result
    } catch (err) {
      console.error('Failed to connect Kolux profile:', err)
      set({ koluxProfileConnecting: false })
      toast.error(
        translate('auto.store.slices.kolux.profiles.33290e88ed', 'Failed to connect profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  refreshCurrentKoluxProfileAuth: async () => {
    try {
      const result = await window.api.koluxProfiles.refreshAuth()
      set({
        koluxProfileAuthStatus: result.auth,
        ...(result.status === 'refreshed'
          ? {
              activeKoluxProfileId: result.activeProfileId,
              koluxProfiles: result.profiles
            }
          : {})
      })
      if (result.status === 'reconnect-required') {
        toast.error(
          translate('auto.store.slices.kolux.profiles.d6e764e7db', 'Reconnect this profile')
        )
      } else if (result.status === 'failed') {
        toast.error(
          translate(
            'auto.store.slices.kolux.profiles.2f6c78a039',
            'Failed to refresh profile auth'
          ),
          { description: result.error }
        )
      }
      return result
    } catch (err) {
      console.error('Failed to refresh Kolux profile auth:', err)
      toast.error(
        translate('auto.store.slices.kolux.profiles.2f6c78a039', 'Failed to refresh profile auth'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  signOutCurrentKoluxProfile: async () => {
    try {
      const result = await window.api.koluxProfiles.signOutCurrent()
      set({
        activeKoluxProfileId: result.activeProfileId,
        koluxProfiles: result.profiles,
        koluxProfileAuthStatus: result.auth
      })
      toast.success(
        translate('auto.store.slices.kolux.profiles.a37b5e6d37', 'Signed out of profile')
      )
      return result
    } catch (err) {
      console.error('Failed to sign out of Kolux profile:', err)
      toast.error(translate('auto.store.slices.kolux.profiles.83600521e7', 'Failed to sign out'), {
        description: err instanceof Error ? err.message : String(err)
      })
      return null
    }
  },

  selectKoluxProfileOrg: async (orgId) => {
    try {
      const result = await window.api.koluxProfiles.selectOrg({ orgId })
      set({
        koluxProfileAuthStatus: result.auth,
        ...(result.status === 'selected'
          ? {
              activeKoluxProfileId: result.activeProfileId,
              koluxProfiles: result.profiles
            }
          : {})
      })
      if (result.status === 'reconnect-required') {
        toast.error(
          translate('auto.store.slices.kolux.profiles.d6e764e7db', 'Reconnect this profile')
        )
      } else if (result.status === 'failed') {
        toast.error(
          translate('auto.store.slices.kolux.profiles.76deec8f58', 'Failed to switch organization'),
          { description: result.error }
        )
      }
      return result
    } catch (err) {
      console.error('Failed to switch Kolux profile org:', err)
      toast.error(
        translate('auto.store.slices.kolux.profiles.76deec8f58', 'Failed to switch organization'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  }
})
