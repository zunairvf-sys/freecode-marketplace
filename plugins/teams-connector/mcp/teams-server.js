/**
 * Microsoft Teams MCP Server - API-based Teams integration
 *
 * Provides tools for reading/sending messages, managing channels,
 * viewing calendar events, and handling tasks via Microsoft Graph API.
 * Uses OAuth 2.0 Authorization Code flow.
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, writeFile } from "fs";
import { promisify } from "util";

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// --- OAuth Token Management ---

async function getToken() {
  const tokenFile = process.env.TEAMS_TOKEN_FILE || "~/.freecode/.teams-token.json";
  const resolvedPath = tokenFile.startsWith("~") ? process.env.HOME + tokenFile.slice(1) : tokenFile;
  try {
    const data = await readFileAsync(resolvedPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveToken(token) {
  const tokenFile = process.env.TEAMS_TOKEN_FILE || "~/.freecode/.teams-token.json";
  const resolvedPath = tokenFile.startsWith("~") ? process.env.HOME + tokenFile.slice(1) : tokenFile;
  await writeFileAsync(resolvedPath, JSON.stringify(token, null, 2));
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
    if (!this.token || Date.now() / 1000 > this.token.expires_in) {
      if (this.token) {
        await this.refreshToken();
        return true;
      }
      return false;
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
      `&redirect_uri=http://localhost:3421/callback` +
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
        redirect_uri: "http://localhost:3421/callback",
      }),
    });
    const data = await response.json();
    if (data.access_token) {
      data.expires_in = Date.now() / 1000 + (data.expires_in || 3600);
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

// --- MCP Server Setup ---

const teams = new TeamsClient();
const server = new McpServer({
  name: "teams-api-connector",
  version: "1.0.0",
});

// --- Auth Tools ---

server.tool(
  "auth_teams",
  "Get the OAuth authorization URL for Microsoft Teams. Open this URL in your browser, authorize the app, then copy the authorization code from the redirect URL and pass it to auth_teams_exchange_code.",
  {},
  async () => {
    const authUrl = teams.getAuthUrl();
    return {
      content: [
        {
          type: "text",
          text: `Open this URL in your browser to authorize Microsoft Teams access:\n\n${authUrl}\n\nAfter authorizing, you will be redirected to a URL containing a 'code' parameter. Copy that code and pass it to the auth_teams_exchange_code tool.`,
        },
      ],
    };
  }
);

server.tool(
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

const unauthMsg = {
  content: [{ type: "text", text: "Not authenticated with Teams. Call auth_teams to get the authorization URL, complete the browser flow, then call auth_teams_exchange_code with the code." }],
  isError: true,
};

server.tool(
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

server.tool(
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

server.tool(
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

server.tool(
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

server.tool(
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

server.tool(
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

server.tool(
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

server.tool(
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

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Teams MCP server running on stdio");
