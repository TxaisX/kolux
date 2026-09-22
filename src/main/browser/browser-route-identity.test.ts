import { describe, expect, it } from 'vitest'
import {
  deriveBrowserRoutePartition,
  deriveBrowserRoutePartitionStorageScope,
  isBrowserRoutePartition
} from './browser-route-identity'

const identity = {
  koluxProfileId: 'kolux/profile:alpha',
  browserProfileId: 'browser/profile:default',
  authorityConnectionIdentity: 'paired/runtime:authority',
  executionHostIdentity: 'ssh/target:private.example'
}

/** Shipping-shaped inputs whose derived names are frozen: both are persisted on disk. */
const pinnedIdentity = {
  koluxProfileId: 'kolux/profile:alpha',
  browserProfileId: 'browser/profile:default',
  authorityConnectionIdentity: 'paired-runtime:authority-a',
  executionHostIdentity: '["kolux-browser-execution-host-storage",1,"authority","env-a"]'
}

describe('browser route partition identity', () => {
  it('derives a stable opaque cross-platform partition and binding fingerprint', () => {
    const first = deriveBrowserRoutePartition(identity)
    const second = deriveBrowserRoutePartition({ ...identity })

    expect(second).toEqual(first)
    expect(first.partition).toMatch(/^persist:kolux-browser-v1-[a-f0-9]{64}$/)
    expect(first.bindingFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(first.partition.slice('persist:'.length)).toMatch(/^[a-z0-9-]+$/)
    for (const rawIdentity of Object.values(identity)) {
      expect(first.partition).not.toContain(rawIdentity)
    }
    expect(first.partition).not.toContain('private.example')
  })

  it('keeps delimiter-containing components structurally distinct', () => {
    const left = deriveBrowserRoutePartition({
      ...identity,
      koluxProfileId: 'a',
      browserProfileId: 'b:c'
    })
    const right = deriveBrowserRoutePartition({
      ...identity,
      koluxProfileId: 'a:b',
      browserProfileId: 'c'
    })

    expect(left).not.toEqual(right)
  })

  it('does not expose equality of individual identity components', () => {
    const baseline = deriveBrowserRoutePartition(identity).partition
    const sameProfile = deriveBrowserRoutePartition({
      ...identity,
      executionHostIdentity: 'ssh/target:other.example'
    }).partition

    expect(baseline.split('-').at(-1)).not.toBe(sameProfile.split('-').at(-1))
    expect(baseline).not.toMatch(/:[a-f0-9]{16}:/)
  })

  // Why: a component dropped from the hash silently merges two jars -- another browser
  // profile's or another paired server's cookies answer to this identity.
  it('makes every identity component load-bearing', () => {
    const derived = [
      identity,
      { ...identity, koluxProfileId: 'kolux/profile:beta' },
      { ...identity, browserProfileId: 'browser/profile:work' },
      { ...identity, authorityConnectionIdentity: 'paired/runtime:other' },
      { ...identity, executionHostIdentity: 'ssh/target:other.example' }
    ].map((entry) => deriveBrowserRoutePartition(entry))

    expect(new Set(derived.map((entry) => entry.partition)).size).toBe(derived.length)
    expect(new Set(derived.map((entry) => entry.bindingFingerprint)).size).toBe(derived.length)
  })

  // Why: both names are persisted, so a changed hash input, order, tag, or version relocates
  // every existing user's cookie jar instead of failing.
  // Golden values recomputed for the 'kolux-browser-route-partition' digest domain (the
  // Nightshift->Kolux rename intentionally changed the hash input; see commit 9baa8d30).
  it('pins the derived partition and fingerprint against silent relocation', () => {
    expect(deriveBrowserRoutePartition(pinnedIdentity)).toEqual({
      partition:
        'persist:kolux-browser-v1-ed7d3b6739789dcb34ecaffebe81a60a0285567514b1ec21fb14684c2e3a3624',
      bindingFingerprint: 'dc02c5dfc77070773f9926af4edc09977d85b3908d14de47fd3cfe0cb46d0bcd'
    })
  })

  it('keeps the partition name and the binding fingerprint in separate digest domains', () => {
    const derived = deriveBrowserRoutePartition(identity)

    expect(derived.partition).not.toContain(derived.bindingFingerprint)
  })

  // Why: removal deletes every partition carrying the scope, so a scope missing either
  // component wipes storage the removed record never owned.
  it('scopes partition ownership to one kolux profile and one environment', () => {
    const scope = deriveBrowserRoutePartitionStorageScope({
      koluxProfileId: 'kolux/profile:alpha',
      environmentId: 'environment-a'
    })

    // Recomputed for the 'kolux-browser-route-partition-scope' digest domain (see 9baa8d30).
    expect(scope).toBe('08738e8754b45cfeda46b30d992a18c37af6f40b4b247061d65194fc2f1089d9')
    expect(
      deriveBrowserRoutePartitionStorageScope({
        koluxProfileId: 'kolux/profile:alpha',
        environmentId: 'environment-b'
      })
    ).not.toBe(scope)
    expect(
      deriveBrowserRoutePartitionStorageScope({
        koluxProfileId: 'kolux/profile:beta',
        environmentId: 'environment-a'
      })
    ).not.toBe(scope)
  })

  // Why: an accepted name is joined onto the partition data root and that directory removed.
  it('recognizes a route partition only as a whole name', () => {
    const valid = deriveBrowserRoutePartition(pinnedIdentity).partition

    expect(isBrowserRoutePartition(valid)).toBe(true)
    for (const value of [
      `../../${valid}`,
      `${valid}/../../escape`,
      `${valid}extra`,
      valid.replace('persist:', '')
    ]) {
      expect(isBrowserRoutePartition(value)).toBe(false)
    }
  })

  it('rejects empty and unbounded identity components', () => {
    expect(() => deriveBrowserRoutePartition({ ...identity, executionHostIdentity: '' })).toThrow(
      'browser_route_partition_identity_invalid'
    )
    expect(() =>
      deriveBrowserRoutePartition({ ...identity, authorityConnectionIdentity: 'x'.repeat(513) })
    ).toThrow('browser_route_partition_identity_invalid')
    expect(() =>
      deriveBrowserRoutePartition({ ...identity, authorityConnectionIdentity: 'é'.repeat(257) })
    ).toThrow('browser_route_partition_identity_invalid')
    expect(() =>
      deriveBrowserRoutePartition({ ...identity, authorityConnectionIdentity: 'é'.repeat(256) })
    ).not.toThrow()
  })
})
