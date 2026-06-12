#!/usr/bin/env node
/**
 * Google Calendar MCP Server
 *
 * Exposes calendar operations via MCP tools using the Google Calendar REST API.
 * OAuth 2.0 token management with automatic refresh.
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Config ---
const CLIENT_ID = process.env.CALENDAR_CLIENT_ID || "";
const CLIENT_SECRET = process.env.CALENDAR_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.CALENDAR_REDIRECT_URI || "http://localhost:41123";
const TOKEN_FILE = path.resolve(
  process.env.CALENDAR_TOKEN_FILE || "~/.freecode/.calendar-token.json"
);
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = "https://www.googleapis.com/auth/calendar";

// --- CalendarClient ---
class CalendarClient {
  constructor() {
    this.tokens = this.loadTokens();
  }

  loadTokens() {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
      }
    } catch (e) {
      console.error("Failed to load token file:", e.message);
    }
    return null;
  }

  saveTokens(t) {
    try {
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), "utf-8");
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
      // Token may have expired - try refresh one more time
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

// --- Server ---
const server = new McpServer({
  name: "calendar-connector",
  version: "1.0.0",
});
const calendar = new CalendarClient();

// --- Auth Tools ---

server.tool(
  "auth_calendar",
  "Get the OAuth authorization URL for Google Calendar. Open this URL in your browser, authorize the app, then copy the authorization code from the redirect URL and pass it to auth_calendar_exchange_code.",
  {},
  async () => {
    const authUrl = calendar.getAuthUrl();
    return {
      content: [
        {
          type: "text",
          text: `Open this URL in your browser to authorize Google Calendar access:\n\n${authUrl}\n\nAfter authorizing, you will be redirected to a URL containing a 'code' parameter. Copy that code and pass it to the auth_calendar_exchange_code tool.`,
        },
      ],
    };
  }
);

server.tool(
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
server.tool(
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
server.tool(
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
server.tool(
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
server.tool(
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
server.tool(
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
server.tool(
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
server.tool(
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
server.tool(
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

// --- Start server ---
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Google Calendar MCP server running on stdio");
}

runServer().catch((e) => {
  console.error("Server failed:", e);
  process.exit(1);
});
