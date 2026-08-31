/**
 * MobileAuth — handles device pairing and session authentication.
 *
 * Pairing flow: DISCOVERED → AUTHENTICATION → PAIRING → PAIRED → CONNECTED → READY
 *
 * Uses a challenge-response protocol to ensure only authorized desktops can
 * control discovered devices. A random device on the same Wi-Fi cannot execute
 * tools without completing pairing.
 */

import { randomBytes, createHash } from 'crypto'
import { mobileRegistry } from './MobileRegistry.js'
import { mobileStore } from './MobileStore.js'

/** Pairing state for a device */
export interface PairingState {
  deviceId: string
  /** Shared secret generated during pairing */
  secret?: string
  /** Timestamp when pairing was completed */
  pairedAt?: number
}

/**
 * Mobile authentication manager.
 *
 * In production, this should use public-key cryptography with certificate
 * pinning. For the initial implementation, we use a challenge-response
 * protocol with a shared secret.
 */
export class MobileAuth {
  private pairingStates: Map<string, PairingState> = new Map()

  /** Restore paired devices from disk into memory */
  public loadFromDisk(): void {
    const entries = mobileStore.load()
    for (const entry of entries) {
      this.pairingStates.set(entry.deviceId, {
        deviceId: entry.deviceId,
        secret: entry.secret,
        pairedAt: entry.pairedAt,
      })
    }
  }

  /**
   * Generate a pairing challenge for a device.
   * The device must sign this challenge with its identity key.
   */
  public generateChallenge(): { challenge: string; nonce: string } {
    const challenge = randomBytes(32).toString('hex')
    const nonce = randomBytes(16).toString('hex')
    return { challenge, nonce }
  }

  /**
   * Verify a device's pairing response.
   * Returns true if the device is authorized.
   */
  public verifyChallenge(deviceId: string, challenge: string, response: string): boolean {
    const state = this.pairingStates.get(deviceId)
    if (!state?.secret) return false

    const expected = createHash('sha256')
      .update(challenge + state.secret)
      .digest('hex')

    return expected === response
  }

  /**
   * Initiate pairing with a device.
   * Returns a pairing code that the user must enter on the device.
   */
  public initiatePairing(deviceId: string): { pairCode: string; challenge: string } {
    const { challenge, nonce } = this.generateChallenge()
    const pairCode = nonce.slice(0, 6).toUpperCase()

    this.pairingStates.set(deviceId, {
      deviceId,
      secret: undefined, // Will be set when device confirms
    })

    return { pairCode, challenge }
  }

  /**
   * Complete pairing with a device.
   * The device sends back a confirmation with the shared secret.
   */
  public completePairing(deviceId: string, secret: string): boolean {
    const state = this.pairingStates.get(deviceId)
    if (!state) return false

    this.pairingStates.set(deviceId, {
      deviceId,
      secret,
      pairedAt: Date.now(),
    })

    // Update registry to paired status
    mobileRegistry.updateStatus(deviceId, 'paired')

    // Persist pairing secret in device info
    const device = mobileRegistry.get(deviceId)
    if (device) {
      // Store paired secret (will be used for session auth)
      this.pairingStates.get(deviceId)!.secret = secret
    }

    // Persist to disk so it survives reloads
    mobileStore.set({
      deviceId,
      name: device?.name ?? 'Unknown',
      model: device?.model ?? 'Unknown',
      host: device?.host ?? '',
      port: device?.port ?? 8765,
      secret,
      pairedAt: Date.now(),
      androidVersion: device?.androidVersion,
      capabilities: device?.capabilities,
    })

    return true
  }

  /**
   * Authenticate a session for a paired device.
   * Returns a session token for use in WebSocket connections.
   */
  public authenticateSession(deviceId: string): string | null {
    const state = this.pairingStates.get(deviceId)
    if (!state?.secret) return null

    const sessionToken = createHash('sha256')
      .update(deviceId + state.secret + Date.now().toString())
      .digest('hex')
      .slice(0, 32)

    return sessionToken
  }

  /**
   * Check if a device is paired.
   */
  public isPaired(deviceId: string): boolean {
    const state = this.pairingStates.get(deviceId)
    return !!state?.secret
  }

  /**
   * Unpair a device.
   */
  public unpair(deviceId: string): void {
    this.pairingStates.delete(deviceId)
    mobileStore.remove(deviceId)
    mobileRegistry.updateStatus(deviceId, 'unpaired')
  }

  /**
   * Get pairing state for a device.
   */
  public getState(deviceId: string): PairingState | undefined {
    return this.pairingStates.get(deviceId)
  }

  /**
   * Generate an API key for manual CLI integration.
   * Format: fc_mob_xxxxxxxxxxxxx
   */
  public generateApiKey(deviceId: string): string | null {
    const state = this.pairingStates.get(deviceId)
    if (!state?.secret) return null

    const key = randomBytes(16).toString('hex').slice(0, 13)
    return `fc_mob_${key}`
  }
}

// Singleton instance
export const mobileAuth = new MobileAuth()
