# API Connector Plugins Architecture

All connector plugins follow the same architecture pattern: a `plugin.json` manifest, a Node.js MCP server, and one or more SKILL.md files.

## Pattern

```
plugins/<name>-connector/
  .FREECODE-plugin/
    plugin.json        # Manifest with user_config, mcpServers, skills
  mcp/
    <name>-server.js   # Node.js MCP server with API client class
  skills/
    <skill-name>/
      SKILL.md         # Skill definition for structured workflows
```

## Available Connectors

| Connector | Service | API | Tools |
|---|---|---|---|
| `gmail-connector` | Gmail | Google Gmail REST API | 14 tools (auth, read, send, search, draft, labels, threads) |
| `zoom-connector` | Zoom | Zoom Meetings API | 12 tools (auth, schedule, list, update, recordings, profile) |
| `teams-connector` | Microsoft Teams | Microsoft Graph API | 10 tools (auth, teams, channels, messages, calendar, users) |
| `calendar-connector` | Google Calendar | Google Calendar REST API | 10 tools (auth, events, free/busy, quick-add, availability) |

## Authentication

All connectors use OAuth 2.0 with token persistence. Since the MCP stdio transport consumes stdin/stdout, authentication happens through dedicated MCP tools rather than terminal prompts.

1. **user_config** in `plugin.json` defines required credentials (`CLIENT_ID`, `CLIENT_SECRET`, etc.)
2. Secrets are marked with `"secret": true` so they're never logged or exposed
3. Each connector exposes two auth tools:
   - `auth_<service>` — Returns the OAuth authorization URL to open in the browser
   - `auth_<service>_exchange_code` — Accepts the authorization code and exchanges it for tokens
4. Tokens are stored in `~/.freecode/.<service>-token.json`
5. Token refresh is automatic; re-auth only when refresh token is revoked
6. If a tool is called without authentication, it returns a clear message directing the user to call the auth tool

## MCP Server Architecture

Each `<name>-server.js` follows the same structure:

```js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "...", version: "1.0.0" });
const client = new <ServiceClient>();

server.tool("tool_name", "description", { params }, async (params) => { ... });

const transport = new StdioServerTransport();
await server.connect(transport);
```

### Client Class Pattern

Each service has a client class handling:
- Token load/save from disk
- Token expiry detection and refresh
- OAuth code exchange (called via `auth_<service>_exchange_code` tool)
- HTTP API calls with auth headers
- 401 retry logic (refresh on expired tokens)

## Environment Variables

The plugin system substitutes `${FREECODE_PLUGIN_OPTION_<KEY>}` variables from user config into the MCP server's `env`. The `${FREECODE_PLUGIN_ROOT}` variable resolves to the plugin directory.

## Installing a Connector

1. Install from marketplace: `freecode marketplace install <name>-connector`
2. Configure credentials when prompted (or set via settings)
3. Call the `auth_<service>` tool to get the OAuth URL
4. Open the URL in your browser, authorize the app
5. Call `auth_<service>_exchange_code` with the authorization code
6. Tools become available immediately after authentication

## Adding a New Connector

1. Create `plugins/<name>-connector/` with the directory structure above
2. Write `plugin.json` with `user_config`, `mcpServers`, and `skills`
3. Implement `<name>-server.js` with client class and tool definitions
4. Write SKILL.md files describing workflows
5. Register in `.FREECODE-plugin/marketplace.json` under the `plugins` array
