import type { MobileE2EEV2Hello, MobileE2EEV2Ready } from './mobile-e2ee-v2-contract'

function repeatedByteBase64(byte: number): string {
  return btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)))
}

export function createMobileE2EEV2Fixture(): {
  hello: MobileE2EEV2Hello
  ready: MobileE2EEV2Ready
  sharedSecret: Uint8Array
} {
  const context = {
    protocol: 'kolux-mobile-e2ee' as const,
    initiator: 'mobile' as const,
    responder: 'desktop' as const,
    transport: 'relay' as const,
    relayHostId: 'AbCdEf0123_-xyZ9'
  }
  return {
    hello: {
      type: 'e2ee_hello',
      v: 2,
      clientPublicKeyB64: repeatedByteBase64(1),
      clientNonceB64: repeatedByteBase64(2),
      capabilities: { framing: [2], payloadKinds: ['text', 'binary'] },
      context
    },
    ready: {
      type: 'e2ee_ready',
      v: 2,
      desktopPublicKeyB64: repeatedByteBase64(3),
      clientNonceB64: repeatedByteBase64(2),
      desktopNonceB64: repeatedByteBase64(4),
      selection: { framing: 2, payloadKinds: ['text', 'binary'] },
      context
    },
    sharedSecret: new Uint8Array(32).fill(5)
  }
}

export const MOBILE_E2EE_V2_VECTOR = {
  transcriptLength: 1350,
  transcriptHashHex: 'f8479d2cba98418d5fd650ef23f1e4659f1fa8a2e4222736e760391ad8d77ffd',
  mobileToDesktopKeyHex: '368178210a7e545ef1454af278d1e4e31ee82c7f5ca877aa18a0cb9549946651',
  desktopToMobileKeyHex: '19af630b414f9c18d22d989fd3f82583f11747f74780eea260be7df6c3565e5c',
  sessionIdHex: '5afe395b0759c3a4e23f04e6ad33c2a7b486dec23c572717d5cca3cc0d3a7ccb'
} as const
