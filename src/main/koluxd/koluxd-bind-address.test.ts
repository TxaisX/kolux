import { describe, expect, it } from 'vitest'
import {
  bindHostIsNetworkExposed,
  describeKoluxdBindExposure,
  KOLUXD_LOOPBACK_BIND_HOST,
  KoluxdBindAddressError,
  resolveKoluxdBindHost
} from './koluxd-bind-address'

describe('resolveKoluxdBindHost', () => {
  it('defaults to loopback when the operator asked for nothing', () => {
    expect(resolveKoluxdBindHost()).toBe(KOLUXD_LOOPBACK_BIND_HOST)
    expect(KOLUXD_LOOPBACK_BIND_HOST).toBe('127.0.0.1')
  })

  it('accepts literal IPv4 and IPv6 addresses, including explicit wide binds', () => {
    expect(resolveKoluxdBindHost('0.0.0.0')).toBe('0.0.0.0')
    expect(resolveKoluxdBindHost('10.1.2.3')).toBe('10.1.2.3')
    expect(resolveKoluxdBindHost('::1')).toBe('::1')
    expect(resolveKoluxdBindHost('localhost')).toBe('127.0.0.1')
    expect(resolveKoluxdBindHost(' 127.0.0.1 ')).toBe('127.0.0.1')
  })

  it('refuses hostnames, because DNS would decide which interface got bound', () => {
    expect(() => resolveKoluxdBindHost('internal.example')).toThrow(KoluxdBindAddressError)
    expect(() => resolveKoluxdBindHost('')).toThrow(KoluxdBindAddressError)
    expect(() => resolveKoluxdBindHost('0.0.0.0:80')).toThrow(KoluxdBindAddressError)
  })
})

describe('bindHostIsNetworkExposed', () => {
  it('separates local-only addresses from network-reachable ones', () => {
    expect(bindHostIsNetworkExposed('127.0.0.1')).toBe(false)
    expect(bindHostIsNetworkExposed('127.5.5.5')).toBe(false)
    expect(bindHostIsNetworkExposed('::1')).toBe(false)
    expect(bindHostIsNetworkExposed('0.0.0.0')).toBe(true)
    expect(bindHostIsNetworkExposed('::')).toBe(true)
    expect(bindHostIsNetworkExposed('10.1.2.3')).toBe(true)
  })

  it('says out loud when a deployment is reachable from the network', () => {
    expect(describeKoluxdBindExposure('0.0.0.0')).toContain('reachable from the network')
    expect(describeKoluxdBindExposure('127.0.0.1')).toContain('local only')
  })
})
