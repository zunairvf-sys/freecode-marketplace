/**
 * Microsoft Teams MCP Server - API-based Teams integration (zero-dependency)
 *
 * Provides tools for reading/sending messages, managing channels,
 * viewing calendar events, and handling tasks via Microsoft Graph API.
 * Uses OAuth 2.0 Authorization Code flow.
 *
 * Uses raw JSON-RPC over stdio — no external npm dependencies required.
 *
 * Tools exposed:
 *   - auth_teams                 Get OAuth authorization URL
 *   - auth_teams_exchange_code   Exchange authorization code for tokens
 *   - teams_list_teams            List teams the user is a member of
 *   - teams_list_channels         List channels in a team
 *   - teams_get_messages          Get messages from a channel
 *   - teams_send_message          Send a message to a channel
 *   - teams_reply_message         Reply to a message
 *   - teams_get_user_messages     Get user's chat messages
 *   - teams_send_chat_message     Send a direct/chat message
 *   - teams_get_calendar          Get calendar events
 *   - teams_create_event          Create a calendar event
 *   - teams_get_tasks             Get planner/TODO tasks
 *   - teams_list_users            List team members
 *
 * Setup:
 *   1. Register app at https://portal.azure.com -> Azure AD -> App registrations
 *   2. Add Graph scopes: Group.Read.All, ChannelMessage.Read.All,
 *      ChannelMessage.Send, Calendar.ReadWrite, Chat.ReadWrite,
 *      User.Read, Tasks.ReadWrite
 *   3. Create client secret
 *   4. Install plugin: freecode plugin install freecode-teams-connector
 *   5. Call auth_teams tool to begin OAuth flow
 */

const { readFile, writeFile, mkdir } = require("fs");
const { promisify } = require("util");
const os = require("os");
const path = require("path");
const http = require("http");
const { URL } = require("url");

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);
const mkdirAsync = promisify(mkdir);

const REDIRECT_URI = process.env.TEAMS_REDIRECT_URI || "http://localhost:3421/callback";

function getTokenPath() {
  const raw = process.env.TEAMS_TOKEN_FILE;
  if (raw && raw !== "" && !raw.startsWith("${")) {
    if (path.isAbsolute(raw)) return raw;
    if (raw.startsWith("~")) return path.join(os.homedir(), raw.slice(1));
    return raw;
  }
  return path.join(os.homedir(), ".freecode", ".teams-token.json");
}

// --- OAuth redirect callback server ---
//
// The OAuth URL points the browser at REDIRECT_URI after consent, but
// nothing listens there by default — the browser shows "site can't be
// reached" and the `code` param is lost. This starts a short-lived local
// HTTP server that catches that redirect, exchanges the code for tokens via
// `exchangeFn`, and shows a confirmation page.
let callbackServer = null;

function startCallbackServer(redirectUri, exchangeFn) {
  if (callbackServer) return;

  let redirect;
  try {
    redirect = new URL(redirectUri);
  } catch {
    return;
  }
  if (redirect.hostname !== "localhost" && redirect.hostname !== "127.0.0.1") return;
  const port = Number(redirect.port) || 80;

  const page = (title, message) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: -apple-system, system-ui, sans-serif; text-align: center; padding: 60px 20px;">
<h2>${title}</h2>
<p>${message}</p>
<p>You can close this tab and return to VS Code.</p>
</body></html>`;

  const server = http.createServer(async (req, res) => {
    let reqUrl;
    try {
      reqUrl = new URL(req.url, redirectUri);
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }

    const code = reqUrl.searchParams.get("code");
    const error = reqUrl.searchParams.get("error");
    res.setHeader("Content-Type", "text/html; charset=utf-8");

    if (error) {
      res.writeHead(400);
      res.end(page("Authorization failed", `The provider returned an error: <code>${error}</code>.`));
    } else if (code) {
      try {
        await exchangeFn(code.trim());
        res.writeHead(200);
        res.end(page("Connected", "Authentication succeeded and your token was saved."));
      } catch (e) {
        res.writeHead(500);
        res.end(page("Authorization failed", `Token exchange failed: ${e.message}`));
      }
    } else {
      res.writeHead(404);
      res.end(page("Not found", "No authorization code was present in this request."));
    }

    setTimeout(() => {
      server.close();
      if (callbackServer === server) callbackServer = null;
    }, 1000);
  });

  server.on("error", () => {
    if (callbackServer === server) callbackServer = null;
  });

  server.listen(port);
  callbackServer = server;
}

// --- OAuth Token Management ---

async function getToken() {
  try { return JSON.parse(await readFileAsync(getTokenPath(), "utf-8")); }
  catch { return null; }
}

async function saveToken(token) {
  const p = getTokenPath();
  await mkdirAsync(path.dirname(p), { recursive: true });
  await writeFileAsync(p, JSON.stringify(token, null, 2));
}

// --- Microsoft Graph API Client ---

class TeamsClient {
  constructor() {
    this.baseUrl = "https://graph.microsoft.com/v1.0";
    this.authUrl = "https://login.microsoftonline.com";
    this.tenantId = process.env.TEAMS_TENANT_ID;
    this.clientId = process.env.TEAMS_CLIENT_ID;
    this.clientSecret = process.env.TEAMS_CLIENT_SECRET;
    this.token = null;
  }

  async ensureAuthenticated() {
    this.token = await getToken();
    if (!this.token) return false;
    // expiry_time stored as epoch seconds; refresh 60s before actual expiry
    if (this.token.expiry_time && this.token.expiry_time - 60 < Date.now() / 1000) {
      if (!this.token.refresh_token) return false;
      try { await this.refreshToken(); } catch { return false; }
    }
    return true;
  }

  getAuthUrl() {
    const scope = encodeURIComponent(
      "https://graph.microsoft.com/Group.Read.All " +
      "https://graph.microsoft.com/ChannelMessage.Read.All " +
      "https://graph.microsoft.com/ChannelMessage.Send " +
      "https://graph.microsoft.com/Calendar.ReadWrite " +
      "https://graph.microsoft.com/Chat.ReadWrite " +
      "https://graph.microsoft.com/User.Read " +
      "https://graph.microsoft.com/Tasks.ReadWrite"
    );
    return (
      `${this.authUrl}/${this.tenantId}/oauth2/v2.0/authorize` +
      `?response_type=code` +
      `&client_id=${this.clientId}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${scope}`
    );
  }

  async exchangeCode(code) {
    const response = await fetch(`${this.authUrl}/${this.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const data = await response.json();
    if (data.access_token) {
      data.expiry_time = Date.now() / 1000 + (data.expires_in || 3600);
      this.token = data;
      await saveToken(data);
      return data;
    }
    throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
  }

  async refreshToken() {
    const response = await fetch(`${this.authUrl}/${this.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "refresh_token",
        refresh_token: this.token.refresh_token,
      }),
    });
    const newToken = await response.json();
    newToken.refresh_token = this.token.refresh_token;
    await saveToken(newToken);
    this.token = newToken;
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}${path}`;
    const opts = {
      method,
      headers: {
        "Authorization": `Bearer ${this.token.access_token}`,
        "Content-Type": "application/json",
      },
    };
    if (body) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Graph API ${res.status}: ${err}`);
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      return res.json();
    }
    return res.text();
  }

  // --- Teams operations ---

  async listTeams() {
    return this.request("GET", "/teams?$select=id,displayName,description");
  }

  async listChannels(teamId) {
    return this.request("GET", `/teams/${teamId}/channels?$select=id,displayName,description`);
  }

  async getMessages(channelId, top = 20) {
    return this.request("GET", `/teams/getByGroupId/id/channels/${channelId}/messages?$top=${top}&$orderby=createdDateTime desc&$select=id,createdDateTime,from,body,subject,replies`);
  }

  async sendMessage(channelId, body, subject) {
    return this.request("POST", `/teams/getByGroupId/id/channels/${channelId}/messages`, {
      subject,
      body: {
        contentType: "html",
        content: body,
      },
    });
  }

  async replyToMessage(channelId, messageId, body) {
    return this.request("POST", `/teams/getByGroupId/id/channels/${channelId}/messages/${messageId}/replies`, {
      body: {
        contentType: "html",
        content: body,
      },
    });
  }

  async getChatMessages(top = 20) {
    return this.request("GET", `/chats?$top=${top}&$orderby=lastMessagePreview/descriptor/createdDateTime desc`);
  }

  async sendChatMessage(chatId, body) {
    return this.request("POST", `/chats/${chatId}/messages`, {
      body: {
        contentType: "text",
        content: body,
      },
    });
  }

  async getCalendarEvents(nextDays = 7) {
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + nextDays * 86400000).toISOString().slice(0, 10);
    return this.request("GET", `/me/calendarView?startDateTime=${start}T00:00:00&endDateTime=${end}T23:59:59`);
  }

  async createCalendarEvent(subject, start, end, body, attendees = []) {
    return this.request("POST", "/me/calendar/events", {
      subject,
      start: { dateTime: start, timeZone: "UTC" },
      end: { dateTime: end, timeZone: "UTC" },
      body: { contentType: "html", content: body || "" },
      attendees: attendees.map(a => ({
        emailAddress: { address: a },
        type: "required",
      })),
    });
  }

  async getTasks() {
    return this.request("GET", "/planner/tasks?$orderby=createdDateTime desc");
  }

  async listTeamMembers(teamId) {
    return this.request("GET", `/teams/${teamId}/members?$select=id,displayName`);
  }
}

// --- Raw MCP JSON-RPC over stdio (no SDK needed) ---

const teams = new TeamsClient();

const tools = [];
function defTool(name, desc, params, handler) {
  tools.push({ name, description: desc, inputSchema: { type: "object", properties: params, required: [] }, handler });
}

const unauthMsg = {
  content: [{ type: "text", text: "Not authenticated with Teams. Call auth_teams to get the authorization URL, complete the browser flow, then call auth_teams_exchange_code with the code." }],
  isError: true,
};

// --- Auth Tools ---

defTool(
  "auth_teams",
  "Get the OAuth authorization URL for Microsoft Teams. Open this URL in your browser and authorize. The redirect is captured automatically. After authorizing, call teams_auth_status to confirm. If capture fails, copy the 'code' param and pass it to auth_teams_exchange_code.",
  {},
  async () => {
    startCallbackServer(REDIRECT_URI, (code) => teams.exchangeCode(code));
    if (await teams.ensureAuthenticated()) {
      return { content: [{ type: "text", text: `Already authenticated with Teams. Call teams_auth_status to verify.\n\nFresh auth URL (if needed):\n${teams.getAuthUrl()}` }] };
    }
    return { content: [{ type: "text", text: `Open this URL in your browser to authorize Microsoft Teams access:\n\n${teams.getAuthUrl()}\n\nAfter authorizing, call teams_auth_status to confirm the token was saved.` }] };
  }
);

defTool(
  "teams_auth_status",
  "Check whether Microsoft Teams authentication is active and the stored token is valid. Call this after auth_teams to confirm before using other tools.",
  {},
  async () => {
    const t = await getToken();
    if (!t) return { content: [{ type: "text", text: `Not authenticated.\nToken file: ${getTokenPath()}\nCall auth_teams to start the OAuth flow.` }] };
    const expiresIn = t.expiry_time ? Math.round(t.expiry_time - Date.now() / 1000) : null;
    const expiryStr = expiresIn !== null ? `expires in ${expiresIn}s` : "no expiry recorded";
    return { content: [{ type: "text", text: `Authenticated with Microsoft Teams.\nToken file: ${getTokenPath()}\nAccess token: present (${expiryStr})\nRefresh token: ${t.refresh_token ? "present" : "missing"}\n\nYou can use Teams tools now.` }] };
  }
);

defTool(
  "auth_teams_exchange_code",
  "Exchange an OAuth authorization code for Microsoft Teams access tokens. Call this after completing the browser auth flow.",
  {
    code: { type: "string", description: "The authorization code from the redirect URL" },
  },
  async ({ code }) => {
    try {
      await teams.exchangeCode(code.trim());
      return {
        content: [
          {
            type: "text",
            text: "Teams authentication successful! Token saved. You can now use Teams tools.",
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Auth failed: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// --- Teams Tools ---

defTool(
  "teams_list_teams",
  "List all Microsoft Teams the user is a member of.",
  {},
  async () => {
    if (!(await teams.ensureAuthenticated())) return unauthMsg;
    const data = await teams.listTeams();
    const list = (data.value || [])
      .map(t => `• ${t.displayName} (ID: ${t.id})${t.description ? ` - ${t.description}` : ""}`)
      .join("\n");
    return {
      content: [
        { type: "text", text: `Teams (${data.value?.length || 0}):\n${list || "No teams found"}` },
      ],
    };
  }
);

defTool(
  "teams_list_channels",
  "List channels in a specific team.",
  {
    teamId: { type: "string", description: "Team ID" },
  },
  async ({ teamId }) => {
    if (!(await teams.ensureAuthenticated())) return unauthMsg;
    const data = await teams.listChannels(teamId);
    const list = (data.value || [])
      .map(c => `• ${c.displayName} (ID: ${c.id})`)
      .join("\n");
    return {
      content: [
        { type: "text", text: `Channels (${data.value?.length || 0}):\n${list || "No channels"}` },
      ],
    };
  }
);

defTool(
  "teams_get_messages",
  "Get recent messages from a channel. Shows sender, time, and content.",
  {
    channelId: { type: "string", description: "Channel ID" },
    top: { type: "number", description: "Number of messages to retrieve", default: 20 },
  },
  async ({ channelId, top }) => {
    if (!(await teams.ensureAuthenticated())) return unauthMsg;
    const data = await teams.getMessages(channelId, top);
    const list = (data.value || [])
      .map(m => {
        const sender = m.from?.user?.displayName || "Unknown";
        const time = m.createdDateTime || "";
        const content = m.body?.content?.replace(/<[^>]*>/g, "")?.slice(0, 200) || "";
        return `• [${time}] ${sender}: ${content}`;
      })
      .join("\n");
    return {
      content: [
        { type: "text", text: `Channel messages:\n${list || "No messages"}` },
      ],
    };
  }
);

defTool(
  "teams_send_message",
  "Send a message to a channel. Supports HTML formatting.",
  {
    channelId: { type: "string", description: "Channel ID" },
    body: { type: "string", description: "Message content (HTML supported)" },
    subject: { type: "string", description: "Message subject (optional)" },
  },
  async ({ channelId, body, subject }) => {
    if (!(await teams.ensureAuthenticated())) return unauthMsg;
    const msg = await teams.sendMessage(channelId, body, subject);
    return {
      content: [
        { type: "text", text: `Message sent to channel ${channelId}.\nMessage ID: ${msg.id}` },
      ],
    };
  }
);

defTool(
  "teams_get_calendar",
  "Get calendar events for the next N days.",
  {
    nextDays: { type: "number", description: "Number of days to look ahead", default: 7 },
  },
  async ({ nextDays }) => {
    if (!(await teams.ensureAuthenticated())) return unauthMsg;
    const data = await teams.getCalendarEvents(nextDays);
    const list = (data.value || [])
      .map(e => `• ${e.subject}\n  ${e.start?.dateTime} → ${e.end?.dateTime}\n  ${e.organizer?.emailAddress?.address || "N/A"}\n`)
      .join("\n");
    return {
      content: [
        { type: "text", text: `Calendar (next ${nextDays} days):\n${list || "No events"}` },
      ],
    };
  }
);

defTool(
  "teams_create_event",
  "Create a calendar event with optional attendees.",
  {
    subject: { type: "string", description: "Event title" },
    start: { type: "string", description: "Start time (ISO 8601)" },
    end: { type: "string", description: "End time (ISO 8601)" },
    body: { type: "string", description: "Event description/body (optional)" },
    attendees: { type: "string", description: "Comma-separated attendee emails (optional)" },
  },
  async ({ subject, start, end, body, attendees }) => {
    if (!(await teams.ensureAuthenticated())) return unauthMsg;
    const attendeeList = attendees ? attendees.split(",").map(a => a.trim()) : [];
    const event = await teams.createCalendarEvent(subject, start, end, body, attendeeList);
    return {
      content: [
        { type: "text", text: `Calendar event created.\nID: ${event.id}\nSubject: ${event.subject}` },
      ],
    };
  }
);

defTool(
  "teams_get_tasks",
  "Get Microsoft Planner tasks assigned to the user.",
  {},
  async () => {
    if (!(await teams.ensureAuthenticated())) return unauthMsg;
    const data = await teams.getTasks();
    const list = (data.value || [])
      .map(t => `• ${t.title} [${t.bucketHint || "N/A"}] - ${t.status || "no status"}`)
      .join("\n");
    return {
      content: [
        { type: "text", text: `Planner tasks (${data.value?.length || 0}):\n${list || "No tasks"}` },
      ],
    };
  }
);

defTool(
  "teams_list_users",
  "List members of a specific team.",
  {
    teamId: { type: "string", description: "Team ID" },
  },
  async ({ teamId }) => {
    if (!(await teams.ensureAuthenticated())) return unauthMsg;
    const data = await teams.listTeamMembers(teamId);
    const list = (data.value || [])
      .map(m => `• ${m.displayName} (ID: ${m.id})`)
      .join("\n");
    return {
      content: [
        { type: "text", text: `Team members (${data.value?.length || 0}):\n${list || "No members"}` },
      ],
    };
  }
);

// --- MCP JSON-RPC server ---

function write(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function handleRequest(msg) {
  const id = msg.id;

  if (msg.method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "teams-api-connector", version: "1.0.1" } } };
  }

  if (msg.method === "notifications/initialized") {
    return null;
  }

  if (msg.method === "tools/list") {
    return {
      jsonrpc: "2.0", id,
      result: { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) },
    };
  }

  if (msg.method === "tools/call") {
    const tool = tools.find(t => t.name === msg.params?.name);
    if (!tool) return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${msg.params?.name}` } };
    try {
      const result = await tool.handler(msg.params || {});
      return { jsonrpc: "2.0", id, result };
    } catch (e) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true } };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method: ${msg.method}` } };
}

// Start callback server at boot so redirect is caught even if process restarted.
startCallbackServer(REDIRECT_URI, (code) => teams.exchangeCode(code));

// Read stdin line by line
const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    const response = await handleRequest(msg);
    if (response) write(response);
  } catch (e) {
    console.error("MCP error:", e.message);
  }
});

console.error("Teams MCP server running on stdio");
