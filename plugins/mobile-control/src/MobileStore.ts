/**
 * MobileStore — persists paired device information to disk.
 *
 * Stored in the workspace's .freecode/mobile-paired.json so it survives
 * extension host restarts (reload window, VS Code restart, etc.).
 *
 * A device remains paired until the user explicitly unpairs it.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface PairedDeviceEntry {
  deviceId: string
  name: string
  model: string
  host: string
  port: number
  secret: string
  pairedAt: number
  androidVersion?: string
  capabilities?: string[]
}

/**
 * Resolve the storage file path.  Lives next to .freecode/settings.json
 * so it is per-workspace and gitignored automatically.
 */
function storePath(): string {
 // Walk up from cwd looking for .freecode/ (covers extension host, CLI,
 // and standalone processes that may not start inside the repo root).
  let dir = process.cwd()
  const root = path.parse(dir).root
  while (dir !== root) {
    const candidate = path.join(dir, '.freecode', 'mobile-paired.json')
    if (fs.existsSync(candidate)) {
      return candidate
    }
    // Also try writing even when file doesn't exist — we want the first
    // .freecode/ directory we hit (or create one at cwd if none exists).
    const fcDir = path.join(dir, '.freecode')
    if (fs.existsSync(fcDir)) {
      return path.join(fcDir, 'mobile-paired.json')
    }
    dir = path.dirname(dir)
  }
  // Fallback: cwd/.freecode/mobile-paired.json
  return path.join(process.cwd(), '.freecode', 'mobile-paired.json')
}

/** Stable identity of THIS desktop, as presented to phones for pairing/trust. */
export interface HostIdentity {
  /** Stable id — persisted once, reused for every pairing. The Android side keys
   *  its trust registry (PairingStore) on this value, so it MUST NOT change
   *  between sessions or the phone will demand re-pairing every launch. */
  hostId: string
  /** Human-readable name shown on the phone's paired-devices list. */
  hostName: string
}

export class MobileStore {
  private _path: string
  private _hostPath: string

  constructor() {
    this._path = storePath()
    this._hostPath = path.join(path.dirname(this._path), 'mobile-host.json')
  }

  /**
   * Get (or lazily create + persist) this desktop's stable host identity.
   *
   * BUG THIS FIXES: previously the pair flow generated a throwaway
   * `fc-desktop-${Date.now()}` hostId on every pairing. Since the phone's
   * PairingStore trusts by hostId, a new id each session meant the phone never
   * recognised a returning desktop → re-pair every launch. A single persisted
   * id makes pairing survive restarts on BOTH sides.
   */
  getHostIdentity(hostName?: string): HostIdentity {
    try {
      const raw = fs.readFileSync(this._hostPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.hostId === 'string' && parsed.hostId) {
        return { hostId: parsed.hostId, hostName: parsed.hostName ?? hostName ?? 'FreeCode Desktop' }
      }
    } catch {
      // not created yet
    }
    // Generate a stable, random id once.
    const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
    const identity: HostIdentity = {
      hostId: `fc-desktop-${rand}`,
      hostName: hostName ?? 'FreeCode Desktop',
    }
    try {
      fs.mkdirSync(path.dirname(this._hostPath), { recursive: true })
    } catch {
      // dir may already exist
    }
    try {
      fs.writeFileSync(this._hostPath, JSON.stringify(identity, null, 2), 'utf8')
    } catch {
      // best-effort; a non-persisted id still works for this session
    }
    return identity
  }

  /** Load all paired device entries from disk */
  load(): PairedDeviceEntry[] {
    try {
      const raw = fs.readFileSync(this._path, 'utf8')
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  /** Save the full list of paired entries to disk */
  save(entries: PairedDeviceEntry[]): void {
    const dir = path.dirname(this._path)
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      // dir may already exist
    }
    fs.writeFileSync(this._path, JSON.stringify(entries, null, 2), 'utf8')
  }

  /** Add or update a paired device entry */
  set(entry: PairedDeviceEntry): void {
    const entries = this.load()
    const idx = entries.findIndex((e: PairedDeviceEntry) => e.deviceId === entry.deviceId)
    if (idx >= 0) {
      entries[idx] = entry
    } else {
      entries.push(entry)
    }
    this.save(entries)
  }

  /** Remove a paired device */
  remove(deviceId: string): void {
    const entries = this.load().filter((e: PairedDeviceEntry) => e.deviceId !== deviceId)
    this.save(entries)
  }

  /** Get a single paired entry */
  get(deviceId: string): PairedDeviceEntry | undefined {
    return this.load().find((e: PairedDeviceEntry) => e.deviceId === deviceId)
  }

  /** Check if a device is paired */
  isPaired(deviceId: string): boolean {
    return this.load().some((e: PairedDeviceEntry) => e.deviceId === deviceId)
  }
}

export const mobileStore = new MobileStore()
