/**
 * MobileConnection — manages a single persistent connection to an Android device.
 *
 * Handles connect/disconnect/reconnect, request/response, heartbeat, and
 * tool execution. Uses WebSocket for the control plane and a separate
 * streaming channel for screen data.
 *
 * The connection routes MCP tool calls through MobileGatewayService on the
 * device, which dispatches to the appropriate native capability (Accessibility,
 * ScreenCapture, DeviceModule, etc.).
 */

import WebSocket from 'ws'
import { mobileRegistry, type MobileDeviceInfo } from './MobileRegistry.js'
import { mobileAuth } from './MobileAuth.js'
import { mobileStore } from './MobileStore.js'

export interface MobileToolCall {
  tool: string
  arguments: Record<string, any>
}

export interface MobileToolResult {
  success: boolean
  error?: string
  data?: any
  /** Which backend was used (e.g. "mediaprojection", "accessibility") */
  backend?: string
}

export interface MobileConnectionOptions {
  /** Heartbeat interval in ms (default 5000) */
  heartbeatInterval?: number
  /** Reconnect attempts before giving up (default 5) */
  maxReconnectAttempts?: number
  /** Connection timeout in ms (default 5000) */
  connectTimeout?: number
}

const DEFAULT_OPTIONS: Required<MobileConnectionOptions> = {
  heartbeatInterval: 5000,
  maxReconnectAttempts: 5,
  connectTimeout: 15000,
}

/**
 * WebSocket-based connection to an Android device.
 *
 * Protocol wire format (JSON over WebSocket):
 *
 * Desktop → Device:
 *   { type: "call", id: string, tool: string, arguments: object }
 *   { type: "ping", id: string }
 *   { type: "stream_start", format: string }
 *   { type: "stream_stop" }
 *
 * Device → Desktop:
 *   { type: "result", id: string, success: bool, data: any, error?: string }
 *   { type: "pong", id: string }
 *   { type: "stream_frame", base64: string, timestamp: number }
 *   { type: "error", error: string }
 */
/** Auth state for a connection */
export interface MobileAuthState {
  /** Whether the connection is authenticated with the device */
  authenticated: boolean
  /** Device info received during auth (may contain real deviceId) */
  deviceInfo?: { deviceId: string; publicKeyBase64: string; model: string }
  /** Whether pairing is required */
  pairingRequired: boolean
}

export class MobileConnection {
  private ws: WebSocket | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pendingCalls: Map<string, { resolve: (v: MobileToolResult) => void; reject: (e: Error) => void }> = new Map()
  private callIdCounter = 0
  private streamCallbacks: Array<(frame: string) => void> = []
  /** Most recent streamed frame, so the observation layer / screenshot fallback
   *  can read "what's on screen right now" without a round-trip. */
  private _latestFrame: { base64: string; timestamp: number; backend?: string; width?: number; height?: number } | null = null
  private _frameCount = 0
  private options: Required<MobileConnectionOptions>
  private _authState: MobileAuthState = { authenticated: false, pairingRequired: false }
  private _connectResolve: ((auth: MobileAuthState) => void) | null = null

  public constructor(
    public deviceId: string,
    public host: string,
    public port: number,
    options?: MobileConnectionOptions,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** Get connection status */
  public get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /** Get current auth state */
  public get authState(): MobileAuthState {
    return { ...this._authState }
  }

  /** Connect to the device and return auth state */
  public async connect(): Promise<MobileAuthState> {
    if (this.connected && this._authState.authenticated) return this._authState

    const device = mobileRegistry.get(this.deviceId)
    if (!device) throw new Error(`Device ${this.deviceId} not found in registry`)

    mobileRegistry.updateStatus(this.deviceId, 'connecting')

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.ws?.close()
        reject(new Error(`Connection to ${this.deviceId} timed out`))
      }, this.options.connectTimeout)

      try {
        const url = `ws://${this.host}:${this.port}/mcp`
        // Present our STABLE host id in the handshake header. The phone's
        // AndroidWebSocketServer reads `X-MCP-Host` and, if the id is in its
        // PairingStore, auto-authenticates the connection with no re-pair. This
        // is the primary reconnect-trust path — it must carry a persisted id.
        const identity = mobileStore.getHostIdentity()
        this.ws = new WebSocket(url, { headers: { 'X-MCP-Host': identity.hostId } })
        this._connectResolve = resolve

        this.ws.onopen = () => {
          // Explicit authenticate as a belt-and-suspenders nudge in case the
          // handshake header was not honoured. The phone checks isTrusted(hostId)
          // and replies `authenticated` (trusted) or `auth_required` (needs pair).
          this.send({
            type: 'authenticate',
            data: { hostId: identity.hostId, hostName: identity.hostName },
          })
        }

        this.ws.onmessage = (event: any) => {
          this.handleMessage(event.data)
        }

        this.ws.onerror = () => {
          clearTimeout(timeout)
          mobileRegistry.updateStatus(this.deviceId, 'network_lost')
        }

        this.ws.onclose = () => {
          clearTimeout(timeout)
          this.stopHeartbeat()
          this.handleDisconnect()
        }
      } catch (e: any) {
        clearTimeout(timeout)
        reject(e)
      }
    })
  }

  /** Send a pair request to the device */
  public async sendPairRequest(code: string, hostId: string, hostName: string, hostPublicKey: string): Promise<boolean> {
    if (!this.connected) throw new Error('Not connected')
    return new Promise((resolve, reject) => {
      const pairTimeout = setTimeout(() => {
        this._pairResolve = null
        reject(new Error('Pair request timed out'))
      }, 15000)
      this._pairResolve = (result: boolean) => {
        clearTimeout(pairTimeout)
        resolve(result)
      }
      this.send({
        type: 'pair',
        data: { code, hostId, hostName, hostPublicKey, hostPublicKeyBase64: hostPublicKey },
      })
    })
  }

  private _pairResolve: ((result: boolean) => void) | null = null

  /** Disconnect from the device */
  public disconnect(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
    mobileRegistry.updateStatus(this.deviceId, 'offline')
  }

  /** Execute a tool call on the device */
  public async callTool(tool: string, args: Record<string, any>): Promise<MobileToolResult> {
    if (!this.connected) {
      const device = mobileRegistry.get(this.deviceId)
      if (device?.status === 'network_lost' || device?.status === 'reconnecting') {
        return {
          success: false,
          error: 'DEVICE_OFFLINE',
          data: { device: this.deviceId, message: `${device.name} is currently offline.` },
        }
      }
      if (device?.status === 'locked') {
        return {
          success: false,
          error: 'DEVICE_LOCKED',
          data: { device: this.deviceId, message: `Device must be unlocked for UI interaction.` },
        }
      }
      throw new Error(`Device ${this.deviceId} is not connected`)
    }

    const id = String(++this.callIdCounter)
    // Canonical call envelope: the phone's executeTool reads `name`/`params`.
    // (Legacy `tool`/`arguments` kept alongside for older gateway builds.)
    this.send({
      type: 'call',
      id,
      name: tool,
      params: args,
      tool,
      arguments: args,
    })

    return new Promise((resolve, reject) => {
      this.pendingCalls.set(id, { resolve, reject })
      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingCalls.has(id)) {
          this.pendingCalls.delete(id)
          reject(new Error(`Tool call "${tool}" timed out after 30s`))
        }
      }, 30000)
    })
  }

  /** Start a screen stream. `fps` is a hint the phone may clamp. */
  public startStream(callback: (frame: string) => void, opts?: { fps?: number; format?: 'jpeg' | 'png' }): void {
    if (!this.connected) throw new Error(`Device ${this.deviceId} is not connected`)
    this.streamCallbacks.push(callback)
    this.send({ type: 'stream_start', format: opts?.format ?? 'jpeg', fps: opts?.fps ?? 2 })
  }

  /** Stop a screen stream */
  public stopStream(): void {
    this.streamCallbacks = []
    this._latestFrame = null
    this.send({ type: 'stream_stop' })
  }

  /** The most recent streamed frame (or null if none received yet). */
  public get latestFrame(): { base64: string; timestamp: number; backend?: string; width?: number; height?: number } | null {
    return this._latestFrame
  }

  /** Total frames received on the current/last stream. */
  public get frameCount(): number {
    return this._frameCount
  }

  /**
   * Resolve as soon as the next stream frame arrives (or the current one if we
   * already hold it), else null after `timeoutMs`. Lets the observation layer
   * grab "what's on screen" right after starting a stream.
   */
  public waitForFrame(timeoutMs = 3000): Promise<typeof this._latestFrame> {
    if (this._latestFrame) return Promise.resolve(this._latestFrame)
    return new Promise((resolve) => {
      let settled = false
      const done = (v: typeof this._latestFrame) => {
        if (settled) return
        settled = true
        this.streamCallbacks = this.streamCallbacks.filter((c) => c !== cb)
        resolve(v)
      }
      const cb = () => done(this._latestFrame)
      this.streamCallbacks.push(cb)
      setTimeout(() => done(this._latestFrame), timeoutMs)
    })
  }

  /** Get device info snapshot */
  public async getDeviceInfo(): Promise<MobileDeviceInfo | undefined> {
    const info = await this.callTool('device.info', {})
    if (info.success && info.data) {
      const device = mobileRegistry.get(this.deviceId)
      if (device) {
        mobileRegistry.updateForegroundApp(
          this.deviceId,
          info.data.foregroundApp ?? device.foregroundApp,
        )
        mobileRegistry.updateLocked(this.deviceId, info.data.locked ?? device.locked)
        return mobileRegistry.get(this.deviceId)
      }
    }
    return mobileRegistry.get(this.deviceId)
  }

  // -- Internal methods --

  private send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  private handleMessage(raw: any): void {
    let msg: any
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      return
    }

    switch (msg.type) {
      case 'result': {
        const pending = this.pendingCalls.get(msg.id)
        if (pending) {
          this.pendingCalls.delete(msg.id)
          // The phone wraps the payload in `value`. Two shapes exist:
          //   ok()-wrapped tools  → value = { success:true, value:<payload>, backend? }
          //   bare-payload tools  → value = { ...payload }        (e.g. device.info)
          // Treat an explicit `error` (or success:false) as the only failure signal;
          // otherwise resolve, unwrapping an inner `value` when present.
          const v = (msg.value ?? msg) as Record<string, any>
          const failed = v?.error != null || v?.success === false
          if (failed) {
            pending.reject(new Error(v?.error ?? msg.error ?? 'Unknown error'))
          } else {
            const { success: _s, error: _e, backend, value: inner, ...rest } = v
            const data = inner !== undefined ? inner : rest
            pending.resolve({ success: true, data, backend })
          }
        }
        break
      }

      case 'pong':
        mobileRegistry.heartbeat(this.deviceId)
        break

      case 'stream_frame':
        this._latestFrame = {
          base64: msg.base64,
          timestamp: msg.timestamp ?? Date.now(),
          backend: msg.backend,
          width: msg.width,
          height: msg.height,
        }
        this._frameCount++
        for (const cb of this.streamCallbacks) {
          try { cb(msg.base64) } catch {}
        }
        break

      case 'error':
        mobileRegistry.updateStatus(this.deviceId, 'network_lost')
        break

      case 'authenticated':
        this._authState.authenticated = true
        mobileRegistry.updateStatus(this.deviceId, 'connected')
        if (!this.heartbeatTimer) this.startHeartbeat()
        if (this._connectResolve) {
          const r = this._connectResolve
          this._connectResolve = null
          r(this._authState)
        }
        break

      case 'auth_required': {
        this._authState.deviceInfo = {
          deviceId: msg.deviceId ?? this.deviceId,
          publicKeyBase64: msg.publicKeyBase64 ?? '',
          model: msg.model ?? 'Unknown',
        }
        // Update registry with real device ID from device. Re-key the registry
        // entry off the IP-derived placeholder onto the phone's stable id so
        // trust (stored under the real id) matches and the id survives DHCP
        // changes.
        if (msg.deviceId && msg.deviceId !== this.deviceId) {
          mobileRegistry.reconcileId(this.deviceId, msg.deviceId)
          this.deviceId = msg.deviceId
        }

        // `auth_required` means the phone does NOT trust our hostId yet (the
        // handshake header + `authenticate` message both failed the isTrusted
        // check). Trust is established purely by pairing (hostId → PairingStore);
        // there is no separate secret to replay. Surface that pairing is needed
        // and resolve so the caller can drive `pair`.
        this._authState.pairingRequired = true
        mobileRegistry.updateStatus(this.deviceId, 'discovered')
        if (this._connectResolve) {
          const r = this._connectResolve
          this._connectResolve = null
          r(this._authState)
        }
        break
      }

      case 'paired':
        this._authState.authenticated = true
        this._authState.pairingRequired = false
        mobileRegistry.updateStatus(this.deviceId, 'paired')
        if (this._pairResolve) {
          const r = this._pairResolve
          this._pairResolve = null
          r(true)
        }
        if (!this.heartbeatTimer) this.startHeartbeat()
        break

      case 'pair_response':
        if (!msg.success && this._pairResolve) {
          const r = this._pairResolve
          this._pairResolve = null
          r(false)
        }
        break

      case 'device_info':
      case undefined:
        // Device sends back info (may or may not have type field)
        if (msg.deviceId) {
          this._authState.deviceInfo = {
            deviceId: msg.deviceId,
            publicKeyBase64: msg.publicKeyBase64 ?? '',
            model: msg.model ?? 'Unknown',
          }
          // Update registry with real device info
          if (msg.deviceId !== this.deviceId) {
            // Device returned a different ID — re-key the registry entry off the
            // IP-derived placeholder onto this stable id, then update connection.
            mobileRegistry.reconcileId(this.deviceId, msg.deviceId)
            this.deviceId = msg.deviceId
          }
          // Update registry with corrected device info
          const existing = mobileRegistry.get(this.deviceId)
          if (existing) {
            mobileRegistry.register({
              ...existing,
              model: msg.model ?? existing.model,
              androidVersion: msg.androidVersion ?? existing.androidVersion,
              protocolVersion: msg.protocolVersion ?? existing.protocolVersion,
              locked: msg.locked ?? existing.locked,
            })
          }
        }
        break
    }
  }

  private handleDisconnect(): void {
    // Reject all pending calls
    for (const [id, handler] of this.pendingCalls) {
      handler.reject(new Error(`Connection lost`))
      this.pendingCalls.delete(id)
    }
    this.streamCallbacks = []

    // Attempt reconnect if this wasn't a deliberate disconnect
    const device = mobileRegistry.get(this.deviceId)
    if (device && device.status === 'paired') {
      this.scheduleReconnect()
    } else {
      mobileRegistry.updateStatus(this.deviceId, 'offline')
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      mobileRegistry.updateStatus(this.deviceId, 'offline')
      return
    }

    this.reconnectAttempts++
    mobileRegistry.updateStatus(this.deviceId, 'reconnecting')

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000)
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
      } catch {
        // Will retry on next heartbeat
      }
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.connected) {
        this.send({ type: 'ping', id: String(Date.now()) })
      } else {
        this.stopHeartbeat()
        mobileRegistry.updateStatus(this.deviceId, 'network_lost')
      }
    }, this.options.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }
}
