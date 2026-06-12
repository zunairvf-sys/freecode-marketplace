#!/usr/bin/env node
/**
 * Zoom MCP Server - API-based Zoom integration (zero-dependency)
 *
 * Provides tools for scheduling, starting, ending, and managing Zoom meetings
 * via the Zoom REST API v2. Uses OAuth 2.0 with token persistence.
 *
 * Uses raw JSON-RPC over stdio — no external npm dependencies required.
 *
 * Tools exposed:
 *   - auth_zoom                  Get OAuth authorization URL
 *   - auth_zoom_exchange_code    Exchange authorization code for tokens
 *   - zoom_schedule_meeting     Schedule a new meeting
 *   - zoom_update_meeting      Update an existing meeting
 *   - zoom_delete_meeting      Cancel a scheduled meeting
 *   - zoom_get_meeting         Get meeting details
 *   - zoom_list_upcoming       List upcoming meetings
 *   - zoom_list_past           List past meetings
 *   - zoom_start_meeting       Start a meeting programmatically
 *   - zoom_end_meeting         End a meeting in progress
 *   - zoom_get_recording       Get recording info for a meeting
 *   - zoom_get_participants    Get participants of a meeting
 *   - zoom_get_user_profile    Get current user profile
 *   - zoom_register_webinar    Register user for a webinar
 *
 * Setup:
 *   1. Create a Zoom OAuth app at https://marketplace.zoom.us
 *   2. Scopes needed: meeting:write, meeting:read, user:read
 *   3. Copy Account ID, Client ID, Client Secret
 *   4. Install plugin: freecode plugin install freecode-zoom-connector
 *   5. Call auth_zoom tool to begin OAuth flow
 */

const { readFile, writeFile } = require("fs");
const { promisify } = require("util");
const http = require("http");
const { URL } = require("url");

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

const REDIRECT_URI = process.env.ZOOM_REDIRECT_URI || "http://localhost:3421/callback";

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
  const tokenFile = process.env.ZOOM_TOKEN_FILE || "~/.freecode/.zoom-token.json";
  const resolvedPath = tokenFile.startsWith("~") ? (process.env.HOME || process.env.USERPROFILE || "") + tokenFile.slice(1) : tokenFile;
  try {
    const data = await readFileAsync(resolvedPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveToken(token) {
  const tokenFile = process.env.ZOOM_TOKEN_FILE || "~/.freecode/.zoom-token.json";
  const resolvedPath = tokenFile.startsWith("~") ? (process.env.HOME || process.env.USERPROFILE || "") + tokenFile.slice(1) : tokenFile;
  await writeFileAsync(resolvedPath, JSON.stringify(token, null, 2));
}

// --- Zoom API Client ---

class ZoomClient {
  constructor() {
    this.baseUrl = "https://api.zoom.us/v2";
    this.accountId = process.env.ZOOM_ACCOUNT_ID;
    this.clientId = process.env.ZOOM_CLIENT_ID;
    this.clientSecret = process.env.ZOOM_CLIENT_SECRET;
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
      "meeting:write:meeting:zoom meeting:read:meeting:zoom user:read:user:zoom"
    );
    return (
      `https://accounts.zoom.us/oauth/authorize` +
      `?response_type=code` +
      `&client_id=${this.clientId}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${scope}`
    );
  }

  async exchangeCode(code) {
    const response = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
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
    const response = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
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
      throw new Error(`Zoom API ${res.status}: ${err}`);
    }
    return res.json();
  }

  // --- Meeting operations ---

  async scheduleMeeting(params) {
    return this.request("POST", "/users/me/meetings", params);
  }

  async getMeeting(meetingId) {
    return this.request("GET", `/meetings/${meetingId}`);
  }

  async updateMeeting(meetingId, params) {
    return this.request("PATCH", `/meetings/${meetingId}`, params);
  }

  async deleteMeeting(meetingId) {
    return this.request("DELETE", `/meetings/${meetingId}`);
  }

  async listMeetings(type = "upcoming") {
    return this.request("GET", `/users/me/meetings?type=${type}`);
  }

  async startMeeting(meetingId, options = {}) {
    return this.request("POST", `/meetings/${meetingId}/start`, options);
  }

  async endMeeting(meetingId) {
    return this.request("POST", `/meetings/${meetingId}/end`);
  }

  async getRecording(meetingUuid) {
    return this.request("GET", `/meetings/${meetingUuid}/recordings`);
  }

  async getParticipants(meetingId) {
    return this.request("GET", `/meetings/${meetingId}/participants`);
  }

  async getUserProfile(userId = "me") {
    return this.request("GET", `/users/${userId}`);
  }

  async getMeetingOccurrences(meetingId) {
    return this.request("GET", `/meetings/${meetingId}/occurrences`);
  }

  async registerForWebinar(webinarId, params) {
    return this.request("POST", `/webinars/${webinarId}/registrants`, params);
  }
}

// --- Raw MCP JSON-RPC over stdio (no SDK needed) ---

const zoom = new ZoomClient();

const tools = [];
function defTool(name, desc, params, handler) {
  tools.push({ name, description: desc, inputSchema: { type: "object", properties: params, required: [] }, handler });
}

const unauthMsg = {
  content: [{ type: "text", text: "Not authenticated with Zoom. Call auth_zoom to get the authorization URL, complete the browser flow, then call auth_zoom_exchange_code with the code." }],
  isError: true,
};

// --- Auth Tools ---

defTool(
  "auth_zoom",
  "Get the OAuth authorization URL for Zoom. Open this URL in your browser and authorize the app. The redirect will be captured automatically and your token saved; if that fails, copy the authorization code from the redirect URL and pass it to auth_zoom_exchange_code.",
  {},
  async () => {
    const authUrl = zoom.getAuthUrl();
    startCallbackServer(REDIRECT_URI, (code) => zoom.exchangeCode(code));
    return {
      content: [
        {
          type: "text",
          text: `Open this URL in your browser to authorize Zoom access:\n\n${authUrl}\n\nAfter authorizing, the browser will be redirected back and your token will be saved automatically. If the page shows an error instead of a confirmation, copy the 'code' parameter from the redirect URL and pass it to the auth_zoom_exchange_code tool.`,
        },
      ],
    };
  }
);

defTool(
  "auth_zoom_exchange_code",
  "Exchange an OAuth authorization code for Zoom access tokens. Call this after completing the browser auth flow.",
  {
    code: { type: "string", description: "The authorization code from the redirect URL" },
  },
  async ({ code }) => {
    try {
      await zoom.exchangeCode(code.trim());
      return {
        content: [
          {
            type: "text",
            text: "Zoom authentication successful! Token saved. You can now use Zoom tools.",
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

// --- Zoom Tools ---

defTool(
  "zoom_schedule_meeting",
  "Schedule a new Zoom meeting. Supports topics, start time, duration, timezone, recurrence, and meeting options.",
  {
    topic: { type: "string", description: "Meeting topic/title" },
    start_time: { type: "string", description: "Start time in ISO 8601 format (e.g., 2024-06-15T14:00:00Z)" },
    duration: { type: "number", description: "Duration in minutes" },
    timezone: { type: "string", description: "Timezone (e.g., America/New_York)", default: "UTC" },
    type: { type: "number", description: "Meeting type: 1=personal, 2=scheduled, 3=recurring", default: 2 },
    password: { type: "string", description: "Meeting password (optional)" },
    settings: { type: "string", description: "JSON string of meeting settings (join_before_host, mute_upon_entry, etc.)" },
  },
  async ({ topic, start_time, duration, timezone, type, password, settings }) => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    const params = {
      topic,
      start_time,
      duration,
      timezone,
      type,
    };
    if (password) params.password = password;
    if (settings) {
      try {
        params.settings = JSON.parse(settings);
      } catch {
        params.settings = { host_video: true, participant_video: false };
      }
    }
    const meeting = await zoom.scheduleMeeting(params);
    return {
      content: [
        {
          type: "text",
          text: `Meeting scheduled successfully!\nTopic: ${meeting.topic}\nStart: ${meeting.start_time}\nDuration: ${meeting.duration} min\nJoin URL: ${meeting.join_url}\nMeeting ID: ${meeting.uuid}`,
        },
      ],
    };
  }
);

defTool(
  "zoom_list_upcoming",
  "List upcoming scheduled meetings.",
  {
    page_size: { type: "number", description: "Number of results per page", default: 10 },
  },
  async ({ page_size }) => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    const meetings = await zoom.listMeetings("upcoming");
    const list = (meetings.meetings || [])
      .slice(0, page_size)
      .map(m => `• ${m.topic} | ${m.start_time} | ${m.duration}min | ${m.join_url}`)
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Upcoming meetings (${meetings.page_count || 0} total):\n${list || "No upcoming meetings"}`,
        },
      ],
    };
  }
);

defTool(
  "zoom_get_meeting",
  "Get details of a specific meeting by its ID or UUID.",
  {
    meetingId: { type: "string", description: "Meeting ID or UUID" },
  },
  async ({ meetingId }) => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    const meeting = await zoom.getMeeting(meetingId);
    return {
      content: [
        {
          type: "text",
          text: `Meeting: ${meeting.topic}\nHost: ${meeting.host?.email || "N/A"}\nStart: ${meeting.start_time}\nDuration: ${meeting.duration} min\nType: ${meeting.type}\nJoin URL: ${meeting.join_url}\nSettings: ${JSON.stringify(meeting.settings || {})}`,
        },
      ],
    };
  }
);

defTool(
  "zoom_update_meeting",
  "Update an existing meeting (topic, time, duration, settings).",
  {
    meetingId: { type: "string", description: "Meeting ID or UUID" },
    topic: { type: "string", description: "New topic (optional)" },
    start_time: { type: "string", description: "New start time (optional)" },
    duration: { type: "number", description: "New duration in minutes (optional)" },
    password: { type: "string", description: "New password (optional)" },
  },
  async ({ meetingId, topic, start_time, duration, password }) => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    const params = {};
    if (topic) params.topic = topic;
    if (start_time) params.start_time = start_time;
    if (duration) params.duration = duration;
    if (password) params.password = password;
    await zoom.updateMeeting(meetingId, params);
    return {
      content: [{ type: "text", text: `Meeting ${meetingId} updated successfully.` }],
    };
  }
);

defTool(
  "zoom_delete_meeting",
  "Cancel a scheduled meeting.",
  {
    meetingId: { type: "string", description: "Meeting ID or UUID to cancel" },
  },
  async ({ meetingId }) => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    await zoom.deleteMeeting(meetingId);
    return {
      content: [{ type: "text", text: `Meeting ${meetingId} cancelled.` }],
    };
  }
);

defTool(
  "zoom_start_meeting",
  "Start a meeting programmatically. Useful for automation workflows.",
  {
    meetingId: { type: "string", description: "Meeting numeric ID" },
    participants: { type: "string", description: "JSON array of participant names (optional)" },
  },
  async ({ meetingId, participants }) => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    const opts = {};
    if (participants) {
      try {
        opts.users = JSON.parse(participants).map(name => ({ user_name: name }));
      } catch {}
    }
    const result = await zoom.startMeeting(meetingId, opts);
    return {
      content: [
        {
          type: "text",
          text: `Meeting started!\nJoin URL: ${result.join_url}\nMeeting ID: ${result.meeting_id}`,
        },
      ],
    };
  }
);

defTool(
  "zoom_end_meeting",
  "End a meeting that is currently in progress.",
  {
    meetingId: { type: "string", description: "Meeting numeric ID to end" },
  },
  async ({ meetingId }) => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    await zoom.endMeeting(meetingId);
    return {
      content: [{ type: "text", text: `Meeting ${meetingId} has been ended.` }],
    };
  }
);

defTool(
  "zoom_get_recording",
  "Get recording information for a completed meeting.",
  {
    meetingId: { type: "string", description: "Meeting UUID" },
  },
  async ({ meetingId }) => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    const recording = await zoom.getRecording(meetingId);
    const recordings = (recording.recording_files || [])
      .map(f => `• ${f.recording_type}: ${f.recording_start} (${f.file_size} bytes) - ${f.playback_url || "processing"}`)
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Recordings for meeting ${meetingId}:\n${recordings || "No recordings found"}`,
        },
      ],
    };
  }
);

defTool(
  "zoom_get_user_profile",
  "Get current Zoom user profile information.",
  {},
  async () => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    const profile = await zoom.getUserProfile();
    return {
      content: [
        {
          type: "text",
          text: `Zoom User Profile:\nName: ${profile.first_name} ${profile.last_name}\nEmail: ${profile.email}\nAccount: ${profile.account_id}\nLicense Type: ${profile.license_type}\nPMI: ${profile.pmi}\nPersonal Meeting Room: ${profile.pmi_url}`,
        },
      ],
    };
  }
);

defTool(
  "zoom_list_past",
  "List past meetings.",
  {
    page_size: { type: "number", description: "Number of results", default: 10 },
  },
  async ({ page_size }) => {
    if (!(await zoom.ensureAuthenticated())) return unauthMsg;
    const meetings = await zoom.listMeetings("past");
    const list = (meetings.meetings || [])
      .slice(0, page_size)
      .map(m => `• ${m.topic} | ${m.start_time} | ${m.duration}min`)
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Past meetings:\n${list || "No past meetings found"}`,
        },
      ],
    };
  }
);

// --- MCP JSON-RPC server ---

function write(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function handleRequest(msg) {
  const id = msg.id;

  if (msg.method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "zoom-api-connector", version: "1.0.1" } } };
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

console.error("Zoom MCP server running on stdio");
