import type { StateCreator } from 'zustand'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type {
  KoluxProfileAuthStatus,
  KoluxProfileSummary,
  SwitchKoluxProfileResult,
  TransferKoluxProfileProjectArgs,
  TransferKoluxProfileProjectResult
} from '../../../../shared/kolux-profiles'
import type { AppState } from '../types'
import {
  createKoluxProfilesAuthActions,
  type KoluxProfilesAuthActions
} from './kolux-profiles-auth-actions'

export type KoluxProfilesSlice = KoluxProfilesAuthActions & {
  koluxProfiles: KoluxProfileSummary[]
  activeKoluxProfileId: string | null
  koluxProfileAuthStatus: KoluxProfileAuthStatus | null
  koluxProfilesMultiProfileUi: boolean
  koluxProfilesLoading: boolean
  koluxProfileSwitching: boolean
  koluxProfileConnecting: boolean
  fetchKoluxProfiles: () => Promise<void>
  fetchKoluxProfileAuthStatus: () => Promise<KoluxProfileAuthStatus | null>
  createLocalKoluxProfile: (name?: string) => Promise<KoluxProfileSummary | null>
  switchKoluxProfile: (profileId: string) => Promise<SwitchKoluxProfileResult | null>
  transferKoluxProfileProject: (
    args: TransferKoluxProfileProjectArgs
  ) => Promise<TransferKoluxProfileProjectResult | null>
}

export const createKoluxProfilesSlice: StateCreator<AppState, [], [], KoluxProfilesSlice> = (
  set,
  get,
  api
) => ({
  koluxProfiles: [],
  activeKoluxProfileId: null,
  koluxProfileAuthStatus: null,
  koluxProfilesMultiProfileUi: false,
  koluxProfilesLoading: false,
  koluxProfileSwitching: false,
  koluxProfileConnecting: false,

  fetchKoluxProfiles: async () => {
    set({ koluxProfilesLoading: true })
    try {
      const [state, authStatus] = await Promise.all([
        window.api.koluxProfiles.list(),
        window.api.koluxProfiles.authStatus()
      ])
      set({
        activeKoluxProfileId: state.activeProfileId,
        koluxProfiles: state.profiles,
        koluxProfilesMultiProfileUi: state.multiProfileUi,
        koluxProfileAuthStatus: authStatus,
        koluxProfilesLoading: false
      })
    } catch (err) {
      console.error('Failed to fetch Kolux profiles:', err)
      set({ koluxProfilesLoading: false })
    }
  },

  fetchKoluxProfileAuthStatus: async () => {
    try {
      const authStatus = await window.api.koluxProfiles.authStatus()
      set({ koluxProfileAuthStatus: authStatus })
      return authStatus
    } catch (err) {
      console.error('Failed to fetch Kolux profile auth status:', err)
      return null
    }
  },

  createLocalKoluxProfile: async (name) => {
    try {
      const state = await window.api.koluxProfiles.createLocal({ name })
      set({
        activeKoluxProfileId: state.activeProfileId,
        koluxProfiles: state.profiles
      })
      void get().fetchKoluxProfileAuthStatus()
      return state.profile
    } catch (err) {
      console.error('Failed to create Kolux profile:', err)
      toast.error(
        translate('auto.store.slices.kolux.profiles.612f7f6861', 'Failed to create profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  ...createKoluxProfilesAuthActions(set, get, api),

  switchKoluxProfile: async (profileId) => {
    if (!profileId || profileId === get().activeKoluxProfileId) {
      return { status: 'already-active' }
    }
    set({ koluxProfileSwitching: true })
    try {
      const result = await window.api.koluxProfiles.switchProfile({ profileId })
      if (result?.status !== 'relaunching') {
        // Why: only a relaunch may keep the switcher locked; a stale
        // "already-active" answer would otherwise disable it forever.
        set({ koluxProfileSwitching: false })
      }
      return result
    } catch (err) {
      console.error('Failed to switch Kolux profile:', err)
      set({ koluxProfileSwitching: false })
      toast.error(
        translate('auto.store.slices.kolux.profiles.7d4bc516ee', 'Failed to switch profile'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  },

  transferKoluxProfileProject: async (args) => {
    try {
      const result = await window.api.koluxProfiles.transferProject(args)
      if (result.status === 'duplicate-target') {
        toast.error(
          translate(
            'auto.store.slices.kolux.profiles.f518e89aa5',
            'Project already exists in that profile'
          )
        )
      }
      if (result.status === 'transferred' && result.willRelaunch) {
        set({ koluxProfileSwitching: true })
      }
      return result
    } catch (err) {
      console.error('Failed to transfer Kolux profile project:', err)
      toast.error(
        translate('auto.store.slices.kolux.profiles.f03ae7f27b', 'Failed to transfer project'),
        {
          description: err instanceof Error ? err.message : String(err)
        }
      )
      return null
    }
  }
})
