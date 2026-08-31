#!/usr/bin/env node
/**
 * freecode-mobile-mcp — standalone stdio MCP server.
 *
 * Discovers and controls Android phones running the FreeCode Agent app over the
 * local network (WebSocket gateway on the phone, port 8765). Exposes the
 * `mobile.*` tools (list_devices, get_device, pair, unpair, call, batch,
 * screenshot, screen_stream) to any MCP client (Claude Code, Claude Desktop…).
 *
 * This is a self-contained copy of the desktop MobileMCP used inside the
 * FreeCode CLI, repackaged for independent publishing. Its only runtime
 * dependencies are `@modelcontextprotocol/sdk` and `ws`; mDNS discovery is
 * hand-rolled over UDP (node:dgram), so there is no native build step.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMobileMcpServer } from './MobileMCP.js'
import { mobileDiscovery, connectionPool } from './MobileDiscovery.js'

async function main(): Promise<void> {
  // Serve immediately; bring the network up in the background. `start()` resolves
  // only after a full LAN sweep (can take many seconds), so we must NOT await it —
  // otherwise the MCP client would hang waiting for the first tools/list.
  const server = createMobileMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)

  // Announce/scan for phones on the LAN, and re-attach any previously-paired
  // devices — all off the critical path.
  mobileDiscovery.start().catch((e) => {
    process.stderr.write(`[mobile-mcp] discovery failed to start: ${e?.message ?? e}\n`)
  })
  connectionPool.connectAll().catch(() => {})
  process.stderr.write('[mobile-mcp] ready on stdio — waiting for a client.\n')

  const shutdown = () => {
    try { mobileDiscovery.stop?.() } catch { /* ignore */ }
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  process.stderr.write(`[mobile-mcp] fatal: ${e?.stack ?? e}\n`)
  process.exit(1)
})
