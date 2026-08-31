# freecode-mobile-control

An [MCP](https://modelcontextprotocol.io) plugin that lets any MCP client
(FreeCode, Claude Code, Claude Desktop, …) **discover and control Android phones**
running the **FreeCode Agent** app over your local **Wi‑Fi** network.

The phone runs a WebSocket gateway (port `8765`); this server finds it via LAN
discovery, pairs with it once, and then routes tool calls to the phone's native
capabilities — accessibility tree, taps/swipes/typing, screenshots, and a live
screen stream.

It ships as a single dependency‑free bundle (`dist/index.mjs`) — **no native
build, no `npm install`, no setup step.**

## Tools

| Tool | Purpose |
| --- | --- |
| `list_devices` | List discovered / paired phones on the network. |
| `get_device` | Details + capabilities + current foreground app for one device. |
| `pair` | Pair with a device (enter the code shown on the phone, or generate one). |
| `unpair` | Remove a device's trust. |
| `call` | Run a native tool on the phone (`computer.tap`, `computer.swipe`, `computer.type`, `accessibility.find`, `screen.dump`, `device.info`, …). |
| `batch` | Run one tool across several phones at once. |
| `screenshot` | Capture the current screen (MediaProjection when active, else accessibility). |
| `screen_stream` | Start/stop a live screen stream; the first frame is returned as an image. |

## Requirements

- Node.js ≥ 18 (the FreeCode/Claude runtime already provides this).
- The **FreeCode Agent** app installed on the Android phone, with its
  accessibility service enabled and notifications allowed.
- The phone and the computer on the **same Wi‑Fi** (see *Networking* below).

## Setup

1. Install this plugin from the marketplace. The MCP server `mobile` starts
   automatically — no build or install step.
2. On the phone, open **Settings → Gateway** and confirm *"Gateway running,
   Listening on port 8765"*.
3. In your client run `list_devices` to confirm the phone appears, then `pair`
   (tap **Generate Code for Desktop** on the phone and enter that code).
4. `call`, `screenshot`, or `screen_stream` to drive it.

## Pairing is trust‑based and **persists indefinitely**

You pair **once** per desktop‑workspace ↔ phone. After that the desktop
reconnects automatically and instantly (no code) using an `X-MCP-Host` identity
header — trust is keyed on a stable id, **not** on the phone's IP address.

**Where trust is stored**

- **Desktop** — under the workspace's `.freecode/`:
  - `mobile-host.json` — this desktop's stable `hostId` (`fc-desktop-…`). Never
    changes, so the phone keeps recognising this workspace across restarts.
  - `mobile-paired.json` — the list of paired phones (deviceId, host, port).
    Survives restarts; a device stays paired until you `unpair`.
- **Phone** — the FreeCode Agent app's `PairingStore` (`trusted_hosts`).
  Survives app restarts **and reboots**; cleared only by tapping *Revoke* on a
  host, or *Rotate Key* (which invalidates all pairings).

A phone's DHCP address can change freely — discovery re‑resolves it by device id
and updates the transport target, so pairing is never lost to an IP change.

## Many‑to‑many by design

- **Many phones → one workspace.** The device registry is keyed by device id, so
  a single workspace can pair with and drive any number of phones at once. Use
  `batch` to run one tool across several phones, or address each by its
  `device` in `call`.
- **One phone → many workspaces.** Each workspace has its own `hostId`, and the
  phone's trust store holds *multiple* trusted desktops (see *Trusted Desktops
  (N)* on the phone). Pair each workspace once; they coexist independently.

## Networking

Discovery uses mDNS multicast (`224.0.0.1:5353`) with a TCP `/24` subnet scan as
a fallback, re‑run every 2 minutes. Connections dial `ws://<phone-ip>:8765/mcp`.

> **If `list_devices` finds the phone but `call` times out**, your router almost
> certainly has **"AP isolation" / "client isolation"** enabled (common on home
> routers, near‑universal on *guest* networks) — it blocks phone‑to‑computer
> traffic even though both have internet. Turn it off, avoid the guest SSID, or
> run the phone's hotspot and join the computer to it.

Keep the phone's gateway (a foreground service) running — if Android stops the
app, nothing is listening until it comes back up.

## Design notes

- **Zero native dependencies.** mDNS‑style discovery is hand‑rolled over UDP
  (`node:dgram`); the runtime deps (`@modelcontextprotocol/sdk`, `ws`) are
  bundled into `dist/index.mjs`.
- **Non‑blocking startup.** The MCP server comes up immediately and runs LAN
  discovery in the background, so the first `tools/list` never waits on a scan.
- This is a self‑contained extraction of the Mobile MCP built into FreeCode; the
  protocol matches the app's gateway exactly.

## Rebuilding the bundle

```bash
bun run build   # bun build ./src/index.ts --target=node --outfile dist/index.mjs
```
