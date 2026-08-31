/**
 * MobileMCP — MCP server for Android device discovery and control.
 *
 * Registers the following tools:
 * - mobile.list_devices  — list all discovered/paired devices
 * - mobile.get_device    — get device details and capabilities
 * - mobile.pair          — initiate pairing with a device
 * - mobile.call          — execute a tool on a device
 * - mobile.batch         — run an operation on multiple devices
 * - mobile.screenshot    — capture a frame from a device
 * - mobile.screen_stream — start/stop a screen stream
 *
 * The desktop owns MCP orchestration and routing. Each Android device
 * is a remote execution node that routes tool calls through its
 * MobileGatewayService to the appropriate native capability.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { mobileRegistry } from './MobileRegistry.js'
import { connectionPool, mobileDiscovery } from './MobileDiscovery.js'
import { mobileAuth } from './MobileAuth.js'
import { mobileStore } from './MobileStore.js'
/** Standalone build: the MCP server name (inlined from the CLI's common.ts). */
const MOBILE_MCP_SERVER_NAME = 'mobile'

// -- Tool definitions --

export const mobileTools = [
  {
    name: 'list_devices',
    description: 'List all discovered and paired Android devices running the FreeCode Agent app. If no devices appear, the user needs to: (1) install the FreeCode Agent app on their Android phone from the Play Store or by installing the APK directly, (2) enable the accessibility service in the app, and (3) ensure the phone is on the same WiFi network as the computer. The app automatically discovers the desktop on the local network once installed.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['unknown', 'discovered', 'paired', 'connected', 'ready', 'locked', 'offline'],
          description: 'Optional — filter by device status',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_device',
    description: 'Get detailed information about a specific device, including capabilities, connection state, and current foreground app.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description: 'Device ID (e.g. fc-001) or name (e.g. "Zunair\'s Galaxy S24")',
        },
      },
      required: ['device'],
      additionalProperties: false,
    },
  },
  {
    name: 'pair',
    description: 'Initiate pairing with a discovered Android device. The device must have the FreeCode Agent app installed and running. If a pairing code was generated on the device, pass it via the "code" parameter. Otherwise a code is generated automatically — the user enters this code on their phone to confirm pairing.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description: 'Device ID or name to pair with from the discovered devices never use the user provided code to look up for device.',
        },
        code: {
          type: 'string',
          description: 'Optional pairing code generated on the device. If omitted, a code is generated automatically.',
        },
      },
      required: ['device'],
      additionalProperties: false,
    },
  },
  {
    name: 'unpair',
    description: 'Remove pairing for a device. The device will need to be paired again before it can be controlled.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description: 'Device ID or name to unpair',
        },
      },
      required: ['device'],
      additionalProperties: false,
    },
  },
  {
    name: 'call',
    description: 'Execute a tool on a paired Android device running the FreeCode Agent app. The tool parameter specifies which native capability to use (e.g. computer.tap, screen.screenshot, accessibility.find). The device routes the call through its MobileGatewayService to the appropriate service.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description: 'Device ID or name',
        },
        tool: {
          type: 'string',
          description: 'Tool to execute (e.g. computer.tap, accessibility.find, screen.screenshot)',
        },
        arguments: {
          type: 'object',
          description: 'Tool-specific arguments',
        },
      },
      required: ['device', 'tool'],
      additionalProperties: false,
    },
  },
  {
    name: 'batch',
    description: 'Run an operation against multiple devices concurrently. Returns results for each device.',
    inputSchema: {
      type: 'object',
      properties: {
        devices: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of device IDs or names',
        },
        tool: {
          type: 'string',
          description: 'Tool to execute on each device',
        },
        arguments: {
          type: 'object',
          description: 'Tool-specific arguments',
        },
      },
      required: ['devices', 'tool'],
      additionalProperties: false,
    },
  },
  {
    name: 'screenshot',
    description: 'Capture a screenshot from a device. Uses MediaProjection when active, falls back to AccessibilityService.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description: 'Device ID or name',
        },
      },
      required: ['device'],
      additionalProperties: false,
    },
  },
  {
    name: 'screen_stream',
    description: 'Start or stop a persistent screen stream from a device. Use action="start" to begin streaming, action="stop" to end.',
    inputSchema: {
      type: 'object',
      properties: {
        device: {
          type: 'string',
          description: 'Device ID or name',
        },
        action: {
          type: 'string',
          enum: ['start', 'stop'],
          description: 'Stream action',
        },
        format: {
          type: 'string',
          enum: ['jpeg', 'png'],
          description: 'Frame format (default: jpeg)',
        },
      },
      required: ['device', 'action'],
      additionalProperties: false,
    },
  },
]

// -- Tool dispatch --

interface ToolArguments {
  device?: string
  tool?: string
  arguments?: Record<string, any>
  devices?: string[]
  action?: string
  format?: string
  status?: string
  code?: string
}

export async function dispatchTool(name: string, args: ToolArguments): Promise<any> {
  switch (name) {
    case 'list_devices': {
      // Wait for discovery scan to complete so we have fresh results
      await mobileDiscovery.waitForScan()
      const devices = mobileRegistry.list(args.status as any)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              devices.map(d => ({
                device_id: d.deviceId,
                name: d.name,
                model: d.model,
                status: d.status,
                locked: d.locked,
                foreground_app: d.foregroundApp,
                capabilities: d.capabilities,
              })),
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'get_device': {
      const device = mobileRegistry.resolve(args.device!) ?? mobileRegistry.get(args.device!)
      if (!device) {
        return {
          content: [{ type: 'text', text: `Device "${args.device}" not found. Use mobile.list_devices to see available devices.` }],
          isError: true,
        }
      }
      const conn = connectionPool.getConnection(device.deviceId)
      const updatedInfo = conn ? await conn.getDeviceInfo() : device
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                device_id: updatedInfo!.deviceId,
                name: updatedInfo!.name,
                model: updatedInfo!.model,
                android_version: updatedInfo!.androidVersion,
                status: updatedInfo!.status,
                locked: updatedInfo!.locked,
                foreground_app: updatedInfo!.foregroundApp,
                capabilities: updatedInfo!.capabilities,
                connected: conn?.connected ?? false,
                last_seen: updatedInfo!.lastSeen,
              },
              null,
              2,
            ),
          },
        ],
      }
    }

    case 'pair': {
      let device = mobileRegistry.resolve(args.device!) ?? mobileRegistry.get(args.device!)
      if (!device) {
        return {
          content: [{ type: 'text', text: `Device "${args.device}" not found.` }],
          isError: true,
        }
      }

      mobileRegistry.updateStatus(device.deviceId, 'pairing')

      // Get or create connection
      let conn = connectionPool.getConnection(device.deviceId)
      if (!conn) {
        conn = connectionPool.createConnection(device)
      }

      // Connect if needed
      if (!conn.connected) {
        try {
          await conn.connect()
        } catch {
          return {
            content: [{ type: 'text', text: `Cannot connect to ${device.name}. Make sure it is on the same network and the gateway is running.` }],
            isError: true,
          }
        }
      }

      const authState = conn.authState

      // Update device info from device if available
      if (authState.deviceInfo?.deviceId && conn.deviceId !== authState.deviceInfo.deviceId) {
        device = mobileRegistry.get(conn.deviceId) ?? device
      }

      // Use provided code (from phone) or generate one
      let pairCode: string
      if (args.code) {
        pairCode = args.code.trim().toUpperCase()
        mobileAuth.initiatePairing(conn.deviceId) // Set up pairing state
      } else {
        const generated = mobileAuth.initiatePairing(conn.deviceId)
        pairCode = generated.pairCode
      }

      // Check if device has a pending code (user entered desktop code on phone)
      const auth = authState
      if (auth.pairingRequired || !auth.authenticated) {
        try {
          // Desktop host identity — STABLE and persisted. The phone keys its
          // trust registry on this hostId, so it must be identical across
          // sessions or pairing won't survive a reconnect.
          const osName = typeof require('os').type === 'function' ? require('os').type() : 'Desktop'
          const hostname = typeof require('os').hostname === 'function' ? require('os').hostname() : 'freecode-desktop'
          const identity = mobileStore.getHostIdentity(`${osName} (${hostname})`)
          const hostId = identity.hostId

          // Send pair request with the code
          const paired = await conn.sendPairRequest(
            pairCode,
            hostId,
            identity.hostName,
            '',  // No public key yet — device accepts based on code match
          )

          if (paired) {
            mobileAuth.completePairing(conn.deviceId, pairCode)
            mobileRegistry.updateStatus(conn.deviceId, 'paired')
            return {
              content: [
                {
                  type: 'text',
                  text: `Paired with ${device.name} (${conn.deviceId}). Device is now trusted.`,
                },
              ],
            }
          } else {
            // Device rejected — the pending code path was used (user entered code on phone)
            // Fall back: the user needs to enter the code on the phone
            return {
              content: [
                {
                  type: 'text',
                  text: `Pairing code generated: ${pairCode}. Enter this code on the device in Settings > Mobile MCP > Pairing. The device has 120 seconds to accept the code.`,
                },
              ],
            }
          }
        } catch (e: any) {
          // Device didn't accept the code (no pending code set) — tell user to enter code on device
          return {
            content: [
              {
                type: 'text',
                text: `Pairing initiated for ${device.name}. Enter code ${pairCode} on the device to complete pairing.`,
              },
            ],
          }
        }
      } else {
        // Already authenticated — just confirm
        mobileAuth.completePairing(conn.deviceId, pairCode)
        mobileRegistry.updateStatus(conn.deviceId, 'paired')
        return {
          content: [
            {
              type: 'text',
              text: `Already connected and trusted. Pairing confirmed for ${device.name}.`,
            },
          ],
        }
      }
    }

    case 'unpair': {
      const device = mobileRegistry.resolve(args.device!) ?? mobileRegistry.get(args.device!)
      if (!device) {
        return {
          content: [{ type: 'text', text: `Device "${args.device}" not found.` }],
          isError: true,
        }
      }
      mobileAuth.unpair(device.deviceId)
      connectionPool.removeConnection(device.deviceId)
      return {
        content: [{ type: 'text', text: `Unpaired ${device.name}.` }],
      }
    }

    case 'call': {
      const device = mobileRegistry.resolve(args.device!) ?? mobileRegistry.get(args.device!)
      if (!device) {
        return agentFriendlyError('DEVICE_NOT_FOUND', args.device!, `"${args.device}" not found. Use mobile.list_devices to see available devices.`)
      }

      // Get or create connection
      let conn = connectionPool.getConnection(device.deviceId)
      if (!conn) {
        conn = connectionPool.createConnection(device)
      }

      // Connect if needed
      if (!conn.connected) {
        try { await conn.connect() } catch {}
      }

      if (!conn.connected) {
        if (device.status === 'locked') {
          return agentFriendlyError('DEVICE_LOCKED', device.deviceId, 'Device must be unlocked for UI interaction.')
        }
        return agentFriendlyError('DEVICE_OFFLINE', device.deviceId, `${device.name} is currently offline.`)
      }

      try {
        const result = await conn.callTool(args.tool!, args.arguments ?? {})
        if (result.success) {
          return {
            content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
            ...(result.backend ? { metadata: { backend: result.backend } } : {}),
          }
        } else {
          return {
            content: [{ type: 'text', text: result.error ?? 'Unknown error' }],
            isError: true,
          }
        }
      } catch (e: any) {
        return {
          content: [{ type: 'text', text: e.message ?? 'Tool execution failed' }],
          isError: true,
        }
      }
    }

    case 'batch': {
      const deviceList: typeof mobileRegistry['prototype' extends keyof any ? never : 'list'] extends (...a: any[]) => any
        ? ReturnType<typeof mobileRegistry.list>
        : never = [] as any
      const unresolved: string[] = []

      for (const devRef of args.devices ?? []) {
        const device = mobileRegistry.resolve(devRef) ?? mobileRegistry.get(devRef)
        if (device) {
          deviceList.push(device)
        } else {
          unresolved.push(devRef)
        }
      }

      const results: Array<{ device: string; result: any }> = []
      const promises = deviceList.map(async (device) => {
        let conn = connectionPool.getConnection(device.deviceId)
        if (!conn) conn = connectionPool.createConnection(device)
        if (!conn.connected) { try { await conn.connect() } catch {} }

        const result = conn.connected
          ? await conn.callTool(args.tool!, args.arguments ?? {})
            .then(r => r)
            .catch(e => ({ success: false, error: e.message }))
          : { success: false, error: 'DEVICE_OFFLINE' }

        return { device: device.deviceId, result }
      })

      await Promise.allSettled(promises.map(p => p.then(r => results.push(r))))

      for (const devRef of unresolved) {
        results.push({ device: devRef, result: { success: false, error: 'DEVICE_NOT_FOUND' } })
      }

      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
    }

    case 'screenshot': {
      // Delegate to mobile.call with screen.screenshot
      return dispatchTool('call', {
        device: args.device,
        tool: 'screen.screenshot',
        arguments: args.arguments ?? {},
      })
    }

    case 'screen_stream': {
      const device = mobileRegistry.resolve(args.device!) ?? mobileRegistry.get(args.device!)
      if (!device) {
        return agentFriendlyError('DEVICE_NOT_FOUND', args.device!, `"${args.device}" not found.`)
      }

      let conn = connectionPool.getConnection(device.deviceId)
      if (!conn) conn = connectionPool.createConnection(device)
      if (!conn.connected) { try { await conn.connect() } catch {} }

      if (!conn.connected) {
        return agentFriendlyError('DEVICE_OFFLINE', device.deviceId, `${device.name} is currently offline.`)
      }

      if (args.action === 'start') {
        // Start streaming; the connection retains the latest frame so the model
        // can "see" the screen. Return the first frame as an image content block
        // so control activation immediately injects the current screen.
        conn.startStream(() => { /* frames retained on the connection */ }, {
          format: (args.format as 'jpeg' | 'png') ?? 'jpeg',
        })
        const first = await conn.waitForFrame(4000)
        if (first?.base64) {
          return {
            content: [
              { type: 'text', text: `Screen stream started for ${device.name} (${first.backend ?? 'capture'}, ${first.width ?? '?'}x${first.height ?? '?'}). Live frames will refresh as the screen changes.` },
              { type: 'image', data: first.base64, mimeType: args.format === 'png' ? 'image/png' : 'image/jpeg' },
            ],
          }
        }
        return {
          content: [{ type: 'text', text: `Screen stream started for ${device.name}, but no frame arrived yet. Ensure screen capture (MediaProjection or Accessibility) is enabled on the phone, then call mobile.screenshot.` }],
        }
      } else {
        conn.stopStream()
        return { content: [{ type: 'text', text: `Screen stream stopped for ${device.name}.` }] }
      }
    }

    default:
      return { content: [{ type: 'text', text: `Unknown mobile tool: ${name}` }], isError: true }
  }
}

function agentFriendlyError(errorCode: string, deviceId: string, message: string): any {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: errorCode, device: deviceId, message }, null, 2),
      },
    ],
    isError: true,
  }
}

// -- Server factory --

export function createMobileMcpServer(): Server {
  const server = new Server(
    { name: MOBILE_MCP_SERVER_NAME, version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async () => ({ tools: mobileTools }),
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params }) => {
      const result = await dispatchTool(String(params.name), params.arguments ?? {})
      return result as any
    },
  )

  return server
}
