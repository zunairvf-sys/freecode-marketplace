/**
 * Zoom MCP Server - API-based Zoom integration
 *
 * Provides tools for scheduling, starting, ending, and managing Zoom meetings
 * via the Zoom REST API v2. Uses OAuth 2.0 with token persistence.
 *
 * Tools exposed:
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
 *   5. First tool call triggers OAuth flow
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, writeFile } from "fs";
import { promisify } from "util";

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// --- OAuth Token Management ---

async function getToken() {
  const tokenFile = process.env.ZOOM_TOKEN_FILE || "~/.freecode/.zoom-token.json";
  const resolvedPath = tokenFile.startsWith("~") ? process.env.HOME + tokenFile.slice(1) : tokenFile;
  try {
    const data = await readFileAsync(resolvedPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveToken(token) {
  const tokenFile = process.env.ZOOM_TOKEN_FILE || "~/.freecode/.zoom-token.json";
  const resolvedPath = tokenFile.startsWith("~") ? process.env.HOME + tokenFile.slice(1) : tokenFile;
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

  async authenticate() {
    this.token = await getToken();
    if (!this.token || Date.now() / 1000 > this.token.expires_in) {
      if (this.token) {
        await this.refreshToken();
      } else {
        console.error(`\n[Zoom OAuth] Open this URL in your browser:`);
        console.error(`${this.getAuthUrl()}\n`);
        return false;
      }
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
      `&redirect_uri=http://localhost:3421/callback` +
      `&scope=${scope}`
    );
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

// --- MCP Server Setup ---

const zoom = new ZoomClient();
const server = new McpServer({
  name: "zoom-api-connector",
  version: "1.0.0",
});

server.tool(
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
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
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

server.tool(
  "zoom_list_upcoming",
  "List upcoming scheduled meetings.",
  {
    page_size: { type: "number", description: "Number of results per page", default: 10 },
  },
  async ({ page_size }) => {
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
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

server.tool(
  "zoom_get_meeting",
  "Get details of a specific meeting by its ID or UUID.",
  {
    meetingId: { type: "string", description: "Meeting ID or UUID" },
  },
  async ({ meetingId }) => {
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
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

server.tool(
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
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
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

server.tool(
  "zoom_delete_meeting",
  "Cancel a scheduled meeting.",
  {
    meetingId: { type: "string", description: "Meeting ID or UUID to cancel" },
  },
  async ({ meetingId }) => {
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
    await zoom.deleteMeeting(meetingId);
    return {
      content: [{ type: "text", text: `Meeting ${meetingId} cancelled.` }],
    };
  }
);

server.tool(
  "zoom_start_meeting",
  "Start a meeting programmatically. Useful for automation workflows.",
  {
    meetingId: { type: "string", description: "Meeting numeric ID" },
    participants: { type: "string", description: "JSON array of participant names (optional)" },
  },
  async ({ meetingId, participants }) => {
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
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

server.tool(
  "zoom_end_meeting",
  "End a meeting that is currently in progress.",
  {
    meetingId: { type: "string", description: "Meeting numeric ID to end" },
  },
  async ({ meetingId }) => {
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
    await zoom.endMeeting(meetingId);
    return {
      content: [{ type: "text", text: `Meeting ${meetingId} has been ended.` }],
    };
  }
);

server.tool(
  "zoom_get_recording",
  "Get recording information for a completed meeting.",
  {
    meetingId: { type: "string", description: "Meeting UUID" },
  },
  async ({ meetingId }) => {
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
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

server.tool(
  "zoom_get_user_profile",
  "Get current Zoom user profile information.",
  {},
  async () => {
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
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

server.tool(
  "zoom_list_past",
  "List past meetings.",
  {
    page_size: { type: "number", description: "Number of results", default: 10 },
  },
  async ({ page_size }) => {
    const authenticated = await zoom.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "Zoom OAuth authentication required." }], isError: true };
    }
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

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Zoom MCP server running on stdio");
