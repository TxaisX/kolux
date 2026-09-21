import { describe, expect, it, vi } from 'vitest'
import {
  allowsPlaintextKoluxCloudSession,
  getKoluxCloudAuthConfig,
  isKoluxCloudDevAuthEnabled
} from './profile-cloud-auth-config'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

describe('Kolux cloud auth config', () => {
  it('reports unconfigured without both API URL and client ID', () => {
    expect(getKoluxCloudAuthConfig({})).toEqual({
      configured: false,
      setupMessage: 'Kolux Cloud sign-in is not configured for this build.'
    })
  })

  it('builds default desktop auth endpoints from the API URL', () => {
    const state = getKoluxCloudAuthConfig({
      KOLUX_CLOUD_API_URL: 'https://kolux-cloud.example/',
      KOLUX_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://kolux-cloud.example',
        authorizeEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/session',
        refreshEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/profile',
        orgEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/org',
        logoutEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://kolux-cloud.example/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://relay.kolux.invalid',
        clientId: 'desktop-client',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('uses first-party production endpoints without runtime env in packaged builds', () => {
    expect(getKoluxCloudAuthConfig({}, true)).toEqual({
      configured: true,
      config: {
        apiBaseUrl: 'https://login.kolux.invalid',
        authorizeEndpoint: 'https://login.kolux.invalid/v1/desktop/auth/authorize',
        sessionEndpoint: 'https://login.kolux.invalid/v1/desktop/auth/session',
        refreshEndpoint: 'https://login.kolux.invalid/v1/desktop/auth/refresh',
        capabilitiesEndpoint: 'https://login.kolux.invalid/v1/desktop/auth/capabilities',
        profileEndpoint: 'https://login.kolux.invalid/v1/desktop/auth/profile',
        orgEndpoint: 'https://login.kolux.invalid/v1/desktop/auth/org',
        logoutEndpoint: 'https://login.kolux.invalid/v1/desktop/auth/logout',
        relayTokenEndpoint: 'https://login.kolux.invalid/v1/desktop/auth/relay-token',
        relayDirectorUrl: 'https://relay.kolux.invalid',
        clientId: 'kolux-desktop',
        scope: 'openid profile email offline_access'
      }
    })
  })

  it('allows loopback HTTP endpoints for local desktop auth development', () => {
    const state = getKoluxCloudAuthConfig({
      KOLUX_CLOUD_API_URL: 'http://localhost:4100',
      KOLUX_CLOUD_CLIENT_ID: 'desktop-client'
    })

    expect(state.configured).toBe(true)
  })

  it('rejects loopback HTTP endpoints in packaged builds', () => {
    expect(
      getKoluxCloudAuthConfig(
        {
          KOLUX_CLOUD_API_URL: 'http://localhost:4100',
          KOLUX_CLOUD_CLIENT_ID: 'desktop-client'
        },
        true
      )
    ).toMatchObject({ configured: false })

    const httpsState = getKoluxCloudAuthConfig(
      {
        KOLUX_CLOUD_API_URL: 'https://kolux-cloud.example',
        KOLUX_CLOUD_CLIENT_ID: 'desktop-client'
      },
      true
    )
    expect(httpsState.configured).toBe(true)
  })

  it('rejects non-HTTPS non-loopback API URLs', () => {
    expect(
      getKoluxCloudAuthConfig({
        KOLUX_CLOUD_API_URL: 'http://kolux-cloud.example',
        KOLUX_CLOUD_CLIENT_ID: 'desktop-client'
      })
    ).toMatchObject({ configured: false })
  })

  it('allows dev plaintext sessions only outside production', () => {
    expect(
      allowsPlaintextKoluxCloudSession({
        KOLUX_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      allowsPlaintextKoluxCloudSession({
        KOLUX_CLOUD_ALLOW_PLAINTEXT_SESSION: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })

  it('ignores dev flags in packaged builds even without NODE_ENV', () => {
    // Why: packaged main bundles never define NODE_ENV, so packaged-ness must
    // gate the escape hatches on its own.
    expect(
      allowsPlaintextKoluxCloudSession({ KOLUX_CLOUD_ALLOW_PLAINTEXT_SESSION: '1' }, true)
    ).toBe(false)
    expect(isKoluxCloudDevAuthEnabled({ KOLUX_CLOUD_DEV_AUTH: '1' }, true)).toBe(false)
  })

  it('allows local dev auth only outside production', () => {
    expect(
      isKoluxCloudDevAuthEnabled({
        KOLUX_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'development'
      })
    ).toBe(true)
    expect(
      isKoluxCloudDevAuthEnabled({
        KOLUX_CLOUD_DEV_AUTH: '1',
        NODE_ENV: 'production'
      })
    ).toBe(false)
  })
})
