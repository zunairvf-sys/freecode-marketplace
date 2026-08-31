/**
 * MobileDiscovery — discovers Android devices on the local network.
 *
 * Uses a two-pronged approach:
 * 1. mDNS listener — receives announcements from _freecode-mcp._tcp
 * 2. Network scanner — probes the local subnet for open port 8765
 *
 * Both approaches use only Node.js builtins (dgram + net) — no npm dependency.
 * mDNS is unreliable on some networks (Windows firewall, router settings),
 * so the TCP scan serves as a fallback that works for everyone.
 */

import * as dgram from 'node:dgram'
import * as net from 'net'
import * as os from 'os'
import { mobileRegistry, type MobileDeviceInfo, MobileDeviceStatus } from './MobileRegistry.js'
import { MobileConnection } from './MobileConnection.js'
import { mobileStore } from './MobileStore.js'
import { mobileAuth } from './MobileAuth.js'

/** mDNS service type for FreeCode mobile devices */
export const MDNS_SERVICE_TYPE = '_freecode-mcp._tcp'

/** mDNS advertisement payload */
export interface MDNSAdvertisement {
  deviceId: string
  deviceName: string
  model: string
  protocolVersion: string
  port: number
}

/** Connection pool for all mobile devices */
export class MobileConnectionPool {
  private connections: Map<string, MobileConnection> = new Map()

  public getConnection(deviceId: string): MobileConnection | undefined {
    return this.connections.get(deviceId)
  }

  public createConnection(device: MobileDeviceInfo): MobileConnection {
    const conn = new MobileConnection(device.deviceId, device.host, device.port)
    this.connections.set(device.deviceId, conn)
    return conn
  }

  public removeConnection(deviceId: string): void {
    const conn = this.connections.get(deviceId)
    conn?.disconnect()
    this.connections.delete(deviceId)
  }

  public async connectAll(): Promise<void> {
    const pairedDevices = mobileRegistry.list('paired')
    for (const device of pairedDevices) {
      let conn = this.getConnection(device.deviceId)
      if (!conn) {
        conn = this.createConnection(device)
      }
      if (!conn.connected) {
        try {
          await conn.connect()
          if (conn.connected) {
            mobileRegistry.updateStatus(device.deviceId, 'connected')
          }
        } catch {
          // Device may be offline — leave status as paired
        }
      }
    }
  }

  public disconnectAll(): void {
    for (const conn of this.connections.values()) {
      conn.disconnect()
    }
    this.connections.clear()
  }

  public get size(): number {
    return this.connections.size
  }
}

export const connectionPool = new MobileConnectionPool()

/**
 * MobileDiscovery service — handles device discovery and registration.
 *
 * In production, this listens for mDNS announcements. During development,
 * devices can be registered directly via registerDevice().
 */
export class MobileDiscovery {
  private discoveryTimer: ReturnType<typeof setInterval> | null = null
  private _mdnsSocket: dgram.Socket | null = null
  private _probeTimer: ReturnType<typeof setInterval> | null = null
  private _scanPromise: Promise<void> | null = null

  /**
   * Register a device from an mDNS advertisement or manual registration.
   */
  public registerDevice(info: {
    deviceId: string
    deviceName: string
    model: string
    androidVersion?: string
    host: string
    port: number
    protocolVersion?: string
    capabilities?: string[]
  }): MobileDeviceInfo {
    const deviceInfo: MobileDeviceInfo = {
      deviceId: info.deviceId,
      name: info.deviceName,
      model: info.model,
      androidVersion: info.androidVersion ?? 'unknown',
      host: info.host,
      port: info.port,
      protocolVersion: info.protocolVersion ?? '1.0',
      status: 'discovered' as MobileDeviceStatus,
      capabilities: info.capabilities ?? this.defaultCapabilities(),
      lastSeen: Date.now(),
      locked: false,
    }

    mobileRegistry.register(deviceInfo)
    return deviceInfo
  }

  /**
   * Start discovery — listen for mDNS announcements and send probe queries.
   * Uses raw UDP multicast (224.0.0.1:5353) — no npm dependency.
   */
  public start(): Promise<void> {
    // Restore paired devices from disk first
    mobileAuth.loadFromDisk()
    this.restorePairedDevices()

    // mDNS listener — may fail on some systems, non-fatal
    try {
      const socket = dgram.createSocket('udp4')
      socket.on('error', () => {})
      socket.bind(() => {
        socket.setMulticastInterface('0.0.0.0')
        try { socket.addMembership('224.0.0.1') } catch {}
        try { socket.setMulticastTTL(255) } catch {}
        try { this.sendMDNSQuery(socket) } catch {}
      })
      socket.on('message', (msg: Buffer, rinfo) => {
        try {
          if (rinfo.address === '224.0.0.1') {
            const devices = this.parseMDNSResponse(msg)
            for (const info of devices) {
              this.registerDevice(info)
            }
          }
        } catch {}
      })
      const probeTimer = setInterval(() => {
        try {
          const addr = socket.address()
          if (addr && addr.address !== '0.0.0.0') {
            this.sendMDNSQuery(socket)
          }
        } catch {}
      }, 5000)
      this._mdnsSocket = socket
      this._probeTimer = probeTimer
    } catch {}

    // TCP network scan — reliable fallback that works regardless of mDNS
    this._scanPromise = this.scanLocalNetwork()
    this._scanPromise.catch(() => {})

    // Rescan every 2 minutes to catch new devices
    this.discoveryTimer = setInterval(() => {
      this.scanLocalNetwork().catch(() => {})
      this.cleanupStaleDevices()
    }, 120000)

    return this._scanPromise
  }

  /** Re-register all paired devices from disk so they show up immediately */
  private restorePairedDevices(): void {
    const entries = mobileStore.load()
    for (const entry of entries) {
      this.registerDevice({
        deviceId: entry.deviceId,
        deviceName: entry.name,
        model: entry.model,
        androidVersion: entry.androidVersion,
        host: entry.host,
        port: entry.port,
        capabilities: entry.capabilities,
      })
      mobileRegistry.updateStatus(entry.deviceId, 'paired')
    }
  }

  /**
   * Wait for the current scan to complete (if any).
   * Used by list_devices to ensure probes have finished.
   */
  public waitForScan(): Promise<void> {
    return this._scanPromise ?? Promise.resolve()
  }

  /** Scan all local subnets for devices with port 8765 open */
  private scanLocalNetwork(): Promise<void> {
    try {
      const interfaces = os.networkInterfaces()
      const subnets = new Set<string>()
      for (const iface of Object.values(interfaces)) {
        for (const config of (iface || [])) {
          if (config.family === 'IPv4' && !config.internal) {
            const parts = config.address.split('.')
            // Skip link-local (169.254.x.x) and loopback
            if (parts[0] === '169' || parts[0] === '127') continue
            if (parts.length === 4) {
              const maskParts = config.netmask.split('.')
              // /24 — scan the full subnet
              if (maskParts[2] === '255') {
                subnets.add(`${parts[0]}.${parts[1]}.${parts[2]}`)
              }
              // /16 — scan the .0 subnet as a representative slice
              else if (maskParts[1] === '255') {
                subnets.add(`${parts[0]}.${parts[1]}.0`)
              }
              // /8 — scan the .0.0 subnet as a representative slice
              else if (maskParts[0] === '255') {
                subnets.add(`${parts[0]}.0.0`)
              }
            }
          }
        }
      }
      // Collect all hosts to probe
      const hosts: string[] = []
      for (const subnet of subnets) {
        for (let i = 1; i <= 254; i++) {
          hosts.push(`${subnet}.${i}`)
        }
      }
      // Probe with limited concurrency to avoid overwhelming device servers
      return this.probeWithConcurrency(hosts, 8765, 10)
    } catch {
      return Promise.resolve()
    }
  }

  /** Probe a list of hosts with a concurrency limit */
  private async probeWithConcurrency(hosts: string[], port: number, concurrency: number): Promise<void> {
    let index = 0
    const workers = Array.from({ length: Math.min(concurrency, hosts.length) }, async () => {
      while (index < hosts.length) {
        const host = hosts[index++]
        await this.probePort(host, port)
      }
    })
    await Promise.all(workers)
  }

  /** Try to connect to a host on port 8765 and register if successful.
   *
   * On a WebSocket "101" upgrade we now read one step further: we send a probe
   * `authenticate` frame and parse the phone's reply (`auth_required` /
   * `device_info`), which carries the real stable `deviceId` (fc-<hash>). We
   * register under THAT id instead of the IP-derived placeholder, so discovery
   * names the device correctly up front — no reliance on a later reconcile, and
   * the id no longer tracks the DHCP address. If the phone sends nothing usable
   * within a short window we fall back to the IP placeholder (previous
   * behaviour) so a quiet-but-present gateway is still listed. */
  private probePort(host: string, port: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      const placeholderId = `fc-${host.replace(/\./g, '')}`
      const socket = net.createConnection({ host, port, timeout: 500 }, () => {
        try {
          const crypto = require('crypto')
          const key = crypto.randomBytes(16).toString('base64')
          const handshake = [
            'GET /mcp HTTP/1.1',
            `Host: ${host}:${port}`,
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Key: ${key}`,
            'Sec-WebSocket-Version: 13',
            '',
            ''
          ].join('\r\n')
          socket.write(handshake)
          // Binary mode: we need raw bytes to decode WebSocket frames.
          let buf = Buffer.alloc(0)
          let upgraded = false
          // Fallback: register with the IP placeholder if no real id arrives.
          const fallbackTimer = setTimeout(() => finish(placeholderId, host), 1200)
          const finish = (deviceId: string, hostForName: string) => {
            if (settled) return
            settled = true
            clearTimeout(fallbackTimer)
            this.registerDevice({
              deviceId,
              deviceName: `FreeCode Device (${hostForName})`,
              model: 'Android Device',
              host,
              port,
            })
            socket.destroy()
            resolve()
          }
          socket.on('data', (chunk: Buffer) => {
            buf = Buffer.concat([buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)])
            if (!upgraded) {
              const headerEnd = buf.indexOf('\r\n\r\n')
              if (headerEnd === -1) return
              const header = buf.slice(0, headerEnd).toString('utf8')
              if (!header.includes(' 101 ')) { clearTimeout(fallbackTimer); socket.destroy(); if (!settled) { settled = true; resolve() }; return }
              upgraded = true
              buf = buf.slice(headerEnd + 4)
              // Prompt the phone for its identity. A probe hostId is untrusted,
              // so the reply is `auth_required` — which still carries deviceId —
              // and no trust is created by this scan.
              socket.write(this.encodeClientFrame(JSON.stringify({
                type: 'authenticate',
                data: { hostId: 'fc-discovery-probe', hostName: 'discovery-probe' },
              })))
            }
            const realId = this.extractDeviceIdFromFrames(buf)
            if (realId) finish(realId, realId)
          })
        } catch {
          socket.destroy()
          if (!settled) { settled = true; resolve() }
        }
      })
      socket.on('error', () => { socket.destroy(); if (!settled) { settled = true; resolve() } })
      socket.on('timeout', () => { socket.destroy(); if (!settled) { settled = true; resolve() } })
    })
  }

  /** Encode a masked client→server WebSocket text frame (RFC 6455). */
  private encodeClientFrame(text: string): Buffer {
    const crypto = require('crypto')
    const payload = Buffer.from(text, 'utf8')
    const len = payload.length
    const mask = crypto.randomBytes(4)
    let header: Buffer
    if (len < 126) {
      header = Buffer.from([0x81, 0x80 | len])
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2)
    }
    const masked = Buffer.alloc(len)
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4]
    return Buffer.concat([header, mask, masked])
  }

  /** Scan buffered server→client WebSocket frames for a JSON message that
   *  carries a `deviceId`, returning the first one found (or undefined). */
  private extractDeviceIdFromFrames(buf: Buffer): string | undefined {
    let off = 0
    while (off + 2 <= buf.length) {
      const opcode = buf[off] & 0x0f
      const b1 = buf[off + 1]
      const masked = (b1 & 0x80) !== 0
      let len = b1 & 0x7f
      let headerLen = 2
      if (len === 126) {
        if (off + 4 > buf.length) break
        len = buf.readUInt16BE(off + 2); headerLen = 4
      } else if (len === 127) {
        if (off + 10 > buf.length) break
        len = Number(buf.readBigUInt64BE(off + 2)); headerLen = 10
      }
      const maskLen = masked ? 4 : 0
      const payloadStart = off + headerLen + maskLen
      if (payloadStart + len > buf.length) break
      let payload = buf.slice(payloadStart, payloadStart + len)
      if (masked) {
        const m = buf.slice(off + headerLen, off + headerLen + 4)
        const un = Buffer.alloc(len)
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ m[i % 4]
        payload = un
      }
      if (opcode === 0x1) {
        try {
          const msg = JSON.parse(payload.toString('utf8'))
          if (msg && typeof msg.deviceId === 'string' && msg.deviceId) return msg.deviceId
        } catch { /* not JSON / partial — keep scanning */ }
      }
      off = payloadStart + len
    }
    return undefined
  }

  /** Send an mDNS query for _freecode-mcp._tcp */
  private sendMDNSQuery(socket: dgram.Socket): void {
    const query = Buffer.alloc(74)
    query.writeUInt16BE(Math.floor(Math.random() * 65535), 0)
    query.writeUInt16BE(0x0000, 2)
    query.writeUInt16BE(1, 4)
    query.writeUInt16BE(0, 6)
    query.writeUInt16BE(0, 8)
    query.writeUInt16BE(0, 10)
    const name = '_freecode-mcp._tcp'
    let offset = 12
    const parts = name.split('.')
    for (const part of parts) {
      query.writeUInt8(part.length, offset++)
      query.write(part, offset)
      offset += part.length
    }
    query.writeUInt8(0, offset++)
    query.writeUInt16BE(0x0001, offset)
    query.writeUInt16BE(1, offset + 2)
    socket.send(query, 0, offset + 4, 5353, '224.0.0.1')
  }

  /** Parse mDNS response buffer and extract device info from TXT records */
  private parseMDNSResponse(msg: Buffer): {
    deviceId: string
    deviceName: string
    model: string
    host: string
    port: number
    protocolVersion?: string
    capabilities?: string[]
  }[] {
    const results: any = []
    if (msg.length < 12) return results

    const ancount = msg.readUInt16BE(6)
    if (ancount === 0) return results

    let offset = 12
    const qdcnt = msg.readUInt16BE(4)
    for (let i = 0; i < qdcnt; i++) {
      offset = this.skipDNSName(msg, offset)
      offset += 4
    }

    for (let i = 0; i < ancount; i++) {
      if (offset >= msg.length - 10) break
      const nameEnd = this.skipDNSName(msg, offset)
      const type = msg.readUInt16BE(nameEnd)
      const rclass = msg.readUInt16BE(nameEnd + 2)
      const rdlength = msg.readUInt16BE(nameEnd + 8)
      const rdoffset = nameEnd + 10

      if (type === 12 && rclass === 1) {
        const txtData = this.extractTXTRecords(msg, rdoffset, rdlength)
        if (txtData.deviceid) {
          results.push({
            deviceId: txtData.deviceid,
            deviceName: `FreeCode-${txtData.deviceid}`,
            model: txtData.model ?? 'Unknown',
            host: txtData.ip ?? '192.168.0.101',
            port: parseInt(txtData.port ?? '8765'),
            protocolVersion: txtData.proto,
          })
        }
      } else if (type === 1 || type === 28) {
        if (type === 1 && rdlength === 4) {
          const ip = `${msg[rdoffset]}.${msg[rdoffset + 1]}.${msg[rdoffset + 2]}.${msg[rdoffset + 3]}`
          if (results.length > 0) {
            const last = results[results.length - 1]
            if (!last.host || last.host === '192.168.0.101') {
              last.host = ip
            }
          }
        }
      }

      offset = rdoffset + rdlength
    }

    return results
  }

  /** Skip a DNS name (with label compression support) and return offset after the name */
  private skipDNSName(buf: Buffer, offset: number): number {
    let pos = offset
    while (pos < buf.length) {
      const len = buf[pos]
      if (len === 0) return pos + 1
      if ((len & 0xc0) === 0xc0) {
        return pos + 2
      }
      pos += len + 1
    }
    return pos
  }

  /** Extract TXT record data into a key-value map */
  private extractTXTRecords(buf: Buffer, offset: number, length: number): Record<string, string> {
    const result: Record<string, string> = {}
    let pos = offset
    const end = offset + length
    while (pos < end && pos < buf.length) {
      const strLen = buf[pos++]
      if (strLen === 0 && pos === offset + 1) break
      const str = buf.toString('ascii', pos, pos + strLen)
      pos += strLen
      const eqIdx = str.indexOf('=')
      if (eqIdx > 0) {
        const key = str.substring(0, eqIdx)
        const value = str.substring(eqIdx + 1)
        result[key] = value
      }
    }
    return result
  }

  /** Stop discovery */
  public stop(): void {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer)
      this.discoveryTimer = null
    }
    if (this._probeTimer) {
      clearInterval(this._probeTimer)
      this._probeTimer = null
    }
    if (this._mdnsSocket) {
      try { this._mdnsSocket.close() } catch {}
      this._mdnsSocket = null
    }
  }

  /** Remove devices that haven't been seen in 5 minutes */
  private cleanupStaleDevices(): void {
    const cutoff = Date.now() - 5 * 60 * 1000
    const devices = mobileRegistry.list()
    for (const device of devices) {
      if (device.lastSeen < cutoff && device.status !== 'offline') {
        mobileRegistry.updateStatus(device.deviceId, 'offline')
        connectionPool.removeConnection(device.deviceId)
      }
    }
  }

  /** Default capabilities for a newly discovered device */
  private defaultCapabilities(): string[] {
    return [
      'device.get_info',
      'device.get_battery',
      'device.connection_status',
      'screen.screenshot',
      'screen.start_stream',
      'screen.stop_stream',
      'computer.tap',
      'computer.swipe',
      'computer.type',
      'computer.back',
      'computer.home',
      'accessibility.find',
      'accessibility.read',
      'accessibility.click',
      'app.launch',
      'app.get_foreground',
      'app.list',
      'agent.status',
    ]
  }
}

// Singleton instance
export const mobileDiscovery = new MobileDiscovery()
