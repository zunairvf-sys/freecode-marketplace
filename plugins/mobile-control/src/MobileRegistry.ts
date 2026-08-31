/**
 * MobileRegistry — maintains the set of discovered and paired Android devices.
 *
 * Each device has a stable FreeCode ID (fc-xxxxxxx), model info, connection
 * state, and capability list. The registry is the single source of truth for
 * which devices are available and what each can do.
 */

export interface MobileDeviceInfo {
  /** Stable FreeCode device ID, e.g. "fc-7a82c91" */
  deviceId: string
  /** Human-readable name, e.g. "Zunair's Galaxy S24" */
  name: string
  /** Device model, e.g. "Samsung Galaxy S24" */
  model: string
  /** Android version string, e.g. "16" */
  androidVersion: string
  /** Network address */
  host: string
  /** Service port */
  port: number
  /** Protocol version for forward-compat */
  protocolVersion: string
  /** Device state */
  status: MobileDeviceStatus
  /** Capability list (device.*, screen.*, computer.*, etc.) */
  capabilities: string[]
  /** Last heartbeat timestamp */
  lastSeen: number
  /** Whether device screen is locked */
  locked: boolean
  /** Current foreground app */
  foregroundApp?: { package: string; name: string }
  /** Pairing secret (only set after pairing) */
  pairedSecret?: string
}

/** Device connection state machine */
export type MobileDeviceStatus =
  | 'unknown'       // newly created, not yet processed
  | 'discovered'    // found via mDNS, not authenticated
  | 'unpaired'      // discovered, awaiting pairing
  | 'pairing'       // pairing in progress
  | 'paired'        // pairing complete, authenticated
  | 'connecting'    // establishing persistent connection
  | 'connected'     // connection established
  | 'ready'         // fully operational
  | 'network_lost'  // connection dropped, will try to reconnect
  | 'reconnecting'  // actively trying to reconnect
  | 'offline'       // device is offline / unreachable
  | 'locked'        // device is locked (limited operations)

export class MobileRegistry {
  private devices: Map<string, MobileDeviceInfo> = new Map()

  /** Register a newly discovered device */
  public register(info: MobileDeviceInfo): void {
    const existing = this.devices.get(info.deviceId)
    if (existing) {
      // Update existing entry with new connection info
      this.devices.set(info.deviceId, { ...existing, ...info })
    } else {
      this.devices.set(info.deviceId, {
        ...info,
        status: info.status ?? 'discovered',
        lastSeen: Date.now(),
        locked: false,
        capabilities: info.capabilities ?? [],
      })
    }
  }

  /** Update device status */
  public updateStatus(deviceId: string, status: MobileDeviceStatus): void {
    const device = this.devices.get(deviceId)
    if (!device) return
    this.devices.set(deviceId, { ...device, status, lastSeen: Date.now() })
  }

  /** Update device lock state */
  public updateLocked(deviceId: string, locked: boolean): void {
    const device = this.devices.get(deviceId)
    if (!device) return
    this.devices.set(deviceId, {
      ...device,
      locked,
      status: locked && device.status === 'ready' ? 'locked' : device.status,
      lastSeen: Date.now(),
    })
  }

  /** Update foreground app */
  public updateForegroundApp(deviceId: string, app: { package: string; name: string }): void {
    const device = this.devices.get(deviceId)
    if (!device) return
    this.devices.set(deviceId, { ...device, foregroundApp: app })
  }

  /** Touch heartbeat */
  public heartbeat(deviceId: string): void {
    const device = this.devices.get(deviceId)
    if (!device) return
    this.devices.set(deviceId, { ...device, lastSeen: Date.now() })
  }

  /** Get device info by ID */
  public get(deviceId: string): MobileDeviceInfo | undefined {
    return this.devices.get(deviceId)
  }

  /** Resolve device by name (fuzzy match) */
  public resolve(name: string | undefined | null): MobileDeviceInfo | undefined {
    if (!name) return undefined
    const lower = name.toLowerCase()
    for (const device of this.devices.values()) {
      if (device.name?.toLowerCase().includes(lower) || device.deviceId.includes(lower)) {
        return device
      }
    }
    return undefined
  }

  /** List all devices, optionally filtered by status */
  public list(status?: MobileDeviceStatus): MobileDeviceInfo[] {
    let result = Array.from(this.devices.values())
    if (status) {
      result = result.filter(d => d.status === status)
    }
    return result
  }

  /** List only ready devices */
  public readyDevices(): MobileDeviceInfo[] {
    return this.list('ready')
  }

  /** Remove a device (e.g. after prolonged offline) */
  public remove(deviceId: string): boolean {
    return this.devices.delete(deviceId)
  }

  /** Clear all devices */
  public clear(): void {
    this.devices.clear()
  }

  /** Get total device count */
  public get size(): number {
    return this.devices.size
  }

  /** Check if a device is ready for operation */
  public isReady(deviceId: string): boolean {
    const device = this.devices.get(deviceId)
    return device?.status === 'ready'
  }

  /** Check if a device is available (connected or ready) */
  public isAvailable(deviceId: string): boolean {
    const device = this.devices.get(deviceId)
    return device?.status === 'ready' || device?.status === 'connected'
  }
}

// Singleton instance — shared across all mobile MCP operations
export const mobileRegistry = new MobileRegistry()
