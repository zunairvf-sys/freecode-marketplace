#!/usr/bin/env node
/**
 * Google Calendar MCP Server (zero-dependency)
 *
 * Exposes calendar operations via MCP tools using the Google Calendar REST API.
 * OAuth 2.0 token management with automatic refresh.
 *
 * Uses raw JSON-RPC over stdio — no external npm dependencies required.
 *
 * Auth tools:
 *   - auth_calendar              Get OAuth authorization URL
 *   - auth_calendar_exchange_code  Exchange authorization code for tokens
 *
 * Calendar tools:
 *   - calendar_list_calendars
 *   - calendar_get_events
 *   - calendar_create_event
 *   - calendar_update_event
 *   - calendar_delete_event
 *   - calendar_free_busy
 *   - calendar_get_event
 *   - calendar_insert_quick_event
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { URL } = require("url");

// --- Config ---
const CLIENT_ID = process.env.CALENDAR_CLIENT_ID || "";
const CLIENT_SECRET = process.env.CALENDAR_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.CALENDAR_REDIRECT_URI || "http://localhost:41123";

function getTokenFile() {
  const raw = process.env.CALENDAR_TOKEN_FILE;
  if (raw && raw !== "" && !raw.startsWith("${")) {
    if (path.isAbsolute(raw)) return raw;
    if (raw.startsWith("~")) return path.join(os.homedir(), raw.slice(1));
    return raw;
  }
  return path.join(os.homedir(), ".freecode", ".calendar-token.json");
}
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = "https://www.googleapis.com/auth/calendar";

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

// --- CalendarClient ---
class CalendarClient {
  constructor() {
    this.tokens = this.loadTokens();
  }

  loadTokens() {
    try {
      const p = getTokenFile();
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch (e) {
      console.error("Failed to load token file:", e.message);
    }
    return null;
  }

  saveTokens(t) {
    try {
      const p = getTokenFile();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(t, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to save token:", e.message);
    }
  }

  get authHeader() {
    return this.tokens ? `Bearer ${this.tokens.access_token}` : "";
  }

  isTokenExpired() {
    if (!this.tokens) return true;
    const expiry = this.tokens.expiry_time || 0;
    return Date.now() >= (expiry - 300000);
  }

  getAuthUrl() {
    return `${AUTH_URL}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;
  }

  async exchangeCode(code) {
    try {
      const resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });
      const data = await resp.json();
      if (data.access_token) {
        if (data.expires_in) {
          data.expiry_time = Date.now() + data.expires_in * 1000;
        }
        this.tokens = data;
        this.saveTokens(data);
        return data;
      }
      throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
    } catch (e) {
      console.error("Token exchange error:", e.message);
      throw e;
    }
  }

  async ensureAuthenticated() {
    if (!this.tokens || this.isTokenExpired()) {
      if (this.tokens && this.tokens.refresh_token) {
        try {
          await this.refreshToken();
          if (this.tokens && !this.isTokenExpired()) return true;
        } catch (e) {
          console.error("Refresh failed, re-auth required");
        }
      }
      return false;
    }
    return true;
  }

  async refreshToken() {
    try {
      const resp = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: this.tokens.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      const data = await resp.json();
      if (data.access_token) {
        this.tokens = { ...this.tokens, ...data };
        if (data.expires_in) {
          this.tokens.expiry_time = Date.now() + data.expires_in * 1000;
        }
        this.saveTokens(this.tokens);
      }
    } catch (e) {
      console.error("Refresh error:", e.message);
      throw e;
    }
  }

  async apiCall(endpoint, options = {}) {
    if (!(await this.ensureAuthenticated())) {
      throw new Error("Not authenticated. Call auth_calendar to get the authorization URL, then auth_calendar_exchange_code with the code.");
    }
    const url = `${CALENDAR_API}${endpoint}`;
    const resp = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (resp.status === 401) {
      if (this.tokens && this.tokens.refresh_token) {
        try {
          await this.refreshToken();
          const retryResp = await fetch(url, {
            ...options,
            headers: {
              Authorization: this.authHeader,
              "Content-Type": "application/json",
              ...options.headers,
            },
          });
          return retryResp.json();
        } catch (e) {
          throw new Error("Authentication expired. Please re-authenticate using auth_calendar and auth_calendar_exchange_code.");
        }
      }
      throw new Error("Authentication expired. Please re-authenticate.");
    }
    return resp.json();
  }
}

// --- Raw MCP JSON-RPC over stdio (no SDK needed) ---

const calendar = new CalendarClient();

const tools = [];
function defTool(name, desc, params, handler) {
  tools.push({ name, description: desc, inputSchema: { type: "object", properties: params, required: [] }, handler });
}

// --- Auth Tools ---

defTool(
  "auth_calendar",
  "Get the OAuth authorization URL for Google Calendar. Open this URL in your browser and authorize. The redirect is captured automatically on the callback port. After authorizing, call calendar_auth_status to confirm. If capture fails, copy the 'code' param and pass it to auth_calendar_exchange_code.",
  {},
  async () => {
    startCallbackServer(REDIRECT_URI, (code) => calendar.exchangeCode(code));
    if (await calendar.ensureAuthenticated()) {
      return { content: [{ type: "text", text: `Already authenticated with Google Calendar. Call calendar_auth_status to verify.\n\nFresh auth URL (if needed):\n${calendar.getAuthUrl()}` }] };
    }
    return { content: [{ type: "text", text: `Open this URL in your browser to authorize Google Calendar access:\n\n${calendar.getAuthUrl()}\n\nAfter authorizing, call calendar_auth_status to confirm the token was saved.` }] };
  }
);

defTool(
  "calendar_auth_status",
  "Check whether Google Calendar authentication is active and the stored token is valid. Call this after auth_calendar to confirm before using other tools.",
  {},
  async () => {
    const t = calendar.tokens || calendar.loadTokens();
    if (!t) return { content: [{ type: "text", text: `Not authenticated.\nToken file: ${getTokenFile()}\nCall auth_calendar to start the OAuth flow.` }] };
    const expiresIn = t.expiry_time ? Math.round((t.expiry_time - Date.now()) / 1000) : null;
    const expiryStr = expiresIn !== null ? `expires in ${expiresIn}s` : "no expiry recorded";
    return { content: [{ type: "text", text: `Authenticated with Google Calendar.\nToken file: ${getTokenFile()}\nAccess token: present (${expiryStr})\nRefresh token: ${t.refresh_token ? "present" : "missing"}\n\nYou can use Calendar tools now.` }] };
  }
);

defTool(
  "auth_calendar_exchange_code",
  "Exchange an OAuth authorization code for Google Calendar access tokens. Call this after completing the browser auth flow.",
  {
    code: { type: "string", description: "The authorization code from the redirect URL" },
  },
  async ({ code }) => {
    try {
      await calendar.exchangeCode(code.trim());
      return {
        content: [
          {
            type: "text",
            text: "Calendar authentication successful! Token saved. You can now use Calendar tools.",
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

// calendar_list_calendars
defTool(
  "calendar_list_calendars",
  "List all calendars accessible by the user.",
  {},
  async () => {
    try {
      const result = await calendar.apiCall("/users/me/calendarList", {
        params: { maxResults: 100 },
      });
      const calendars = (result.items || []).map((c) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary || false,
        timezone: c.timeZone,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ calendars }, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// calendar_get_events
defTool(
  "calendar_get_events",
  "Get events from a calendar within a time range.",
  {
    calendarId: {
      type: "string",
      description: "Calendar ID. Use 'primary' for the main calendar.",
    },
    timeMin: {
      type: "string",
      description: "Start time in ISO 8601 format (optional).",
    },
    timeMax: {
      type: "string",
      description: "End time in ISO 8601 format (optional).",
    },
    maxResults: {
      type: "number",
      description: "Maximum number of events to return.",
    },
  },
  async ({ calendarId, timeMin, timeMax, maxResults }) => {
    try {
      const params = new URLSearchParams({
        maxResults: (maxResults || 50).toString(),
        singleEvents: "true",
        orderBy: "startTime",
      });
      if (timeMin) params.set("timeMin", timeMin);
      if (timeMax) params.set("timeMax", timeMax);
      const result = await calendar.apiCall(
        `/${encodeURIComponent(calendarId || "primary")}/events?${params}`,
        { method: "GET" }
      );
      const events = (result.items || []).map((e) => ({
        id: e.id,
        summary: e.summary,
        description: e.description,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        status: e.status,
        htmlLink: e.htmlLink,
        attendees: e.attendees?.map((a) => ({ email: a.email, responseStatus: a.responseStatus })),
        location: e.location,
      }));
      return {
        content: [{ type: "text", text: JSON.stringify({ events }, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// calendar_create_event
defTool(
  "calendar_create_event",
  "Create a new event on the calendar.",
  {
    calendarId: {
      type: "string",
      description: "Calendar ID. Use 'primary' for the main calendar.",
    },
    summary: {
      type: "string",
      description: "Event title.",
    },
    description: {
      type: "string",
      description: "Event description (optional).",
    },
    startTime: {
      type: "string",
      description: "Start time in ISO 8601 format.",
    },
    endTime: {
      type: "string",
      description: "End time in ISO 8601 format.",
    },
    location: {
      type: "string",
      description: "Event location (optional).",
    },
    attendees: {
      type: "array",
      description: "Array of attendee email addresses (optional).",
    },
  },
  async ({ calendarId, summary, description, startTime, endTime, location, attendees }) => {
    try {
      const event = {
        summary,
        description: description || undefined,
        start: { dateTime: startTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        end: { dateTime: endTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      };
      if (location) event.location = location;
      if (attendees && attendees.length > 0) {
        event.attendees = attendees.map((e) => ({ email: e }));
      }
      const result = await calendar.apiCall(
        `/${encodeURIComponent(calendarId || "primary")}/events`,
        {
          method: "POST",
          body: JSON.stringify(event),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: result.id,
                htmlLink: result.htmlLink,
                status: result.status,
                summary: result.summary,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// calendar_update_event
defTool(
  "calendar_update_event",
  "Update an existing event.",
  {
    calendarId: {
      type: "string",
      description: "Calendar ID. Use 'primary' for the main calendar.",
    },
    eventId: {
      type: "string",
      description: "Event ID to update.",
    },
    summary: {
      type: "string",
      description: "New event title (optional).",
    },
    description: {
      type: "string",
      description: "New description (optional).",
    },
    startTime: {
      type: "string",
      description: "New start time in ISO 8601 (optional).",
    },
    endTime: {
      type: "string",
      description: "New end time in ISO 8601 (optional).",
    },
    location: {
      type: "string",
      description: "New location (optional).",
    },
  },
  async ({ calendarId, eventId, summary, description, startTime, endTime, location }) => {
    try {
      const cal = calendarId || "primary";
      const current = await calendar.apiCall(
        `/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`
      );
      if (summary !== undefined) current.summary = summary;
      if (description !== undefined) current.description = description;
      if (location !== undefined) current.location = location;
      if (startTime) {
        current.start = { dateTime: startTime, timeZone: current.start?.timeZone };
      }
      if (endTime) {
        current.end = { dateTime: endTime, timeZone: current.end?.timeZone };
      }
      const result = await calendar.apiCall(
        `/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`,
        {
          method: "PUT",
          body: JSON.stringify(current),
        }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { id: result.id, htmlLink: result.htmlLink, status: result.status },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// calendar_delete_event
defTool(
  "calendar_delete_event",
  "Delete an event from the calendar.",
  {
    calendarId: {
      type: "string",
      description: "Calendar ID. Use 'primary' for the main calendar.",
    },
    eventId: {
      type: "string",
      description: "Event ID to delete.",
    },
  },
  async ({ calendarId, eventId }) => {
    try {
      const cal = calendarId || "primary";
      await calendar.apiCall(
        `/${encodeURIComponent(cal)}/events/${encodeURIComponent(eventId)}`,
        { method: "DELETE" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ deleted: true, eventId }, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// calendar_free_busy
defTool(
  "calendar_free_busy",
  "Check free/busy availability for a time range.",
  {
    emails: {
      type: "array",
      description: "Array of email addresses or calendar IDs to check.",
    },
    timeMin: {
      type: "string",
      description: "Start time in ISO 8601 format.",
    },
    timeMax: {
      type: "string",
      description: "End time in ISO 8601 format.",
    },
  },
  async ({ emails, timeMin, timeMax }) => {
    try {
      const result = await calendar.apiCall("/freeBusy", {
        method: "POST",
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: emails.map((e) => ({ id: e })),
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ freeBusy: result.calendars }, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// calendar_get_event
defTool(
  "calendar_get_event",
  "Get details of a single event.",
  {
    calendarId: {
      type: "string",
      description: "Calendar ID. Use 'primary' for the main calendar.",
    },
    eventId: {
      type: "string",
      description: "Event ID to retrieve.",
    },
  },
  async ({ calendarId, eventId }) => {
    try {
      const result = await calendar.apiCall(
        `/${encodeURIComponent(calendarId || "primary")}/events/${encodeURIComponent(eventId)}`
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// calendar_insert_quick_event
defTool(
  "calendar_insert_quick_event",
  "Quick-add an event using natural language parsing.",
  {
    calendarId: {
      type: "string",
      description: "Calendar ID. Use 'primary' for the main calendar.",
    },
    text: {
      type: "string",
      description: "Natural language event description (e.g., 'Lunch meeting tomorrow at noon').",
    },
  },
  async ({ calendarId, text }) => {
    try {
      const result = await calendar.apiCall(
        `/${encodeURIComponent(calendarId || "primary")}/events/quickAdd?supportsAttachments=true`,
        {
          method: "POST",
          body: new URLSearchParams({ text }).toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { id: result.id, htmlLink: result.htmlLink, summary: result.summary },
              null,
              2
            ),
          },
        ],
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// --- MCP JSON-RPC server ---

function write(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function handleRequest(msg) {
  const id = msg.id;

  if (msg.method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "calendar-api-connector", version: "1.0.1" } } };
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

// Start callback server at boot so Google's redirect is caught even if the
// process restarted between auth_calendar being called and the browser redirect.
startCallbackServer(REDIRECT_URI, (code) => calendar.exchangeCode(code));

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

console.error("Google Calendar MCP server running on stdio");
