/**
 * Gmail MCP Server - API-based Gmail integration
 *
 * Provides tools for reading, searching, composing, sending, and labeling emails
 * via the Gmail REST API. Uses OAuth 2.0 with token persistence.
 *
 * Tools exposed:
 *   - gmail_read_inbox         List recent messages with filters
 *   - gmail_read_message       Read a full message by ID
 *   - gmail_search_messages    Search messages by query
 *   - gmail_compose_draft      Create a draft email
 *   - gmail_send_message       Send an email immediately
 *   - gmail_reply_to_thread    Reply to an existing thread
 *   - gmail_add_labels         Add labels to messages
 *   - gmail_get_labels         List all labels
 *   - gmail_delete_message     Move a message to trash
 *   - gmail_mark_as_read       Mark messages as read/unread
 *   - gmail_thread_history     Get full thread conversation
 *   - gmail_send_html          Send HTML-formatted email
 *
 * Setup:
 *   1. Create project at https://console.cloud.google.com
 *   2. Enable Gmail API
 *   3. Create OAuth 2.0 credentials (Desktop app type)
 *   4. Download client_secret.json or copy Client ID + Secret
 *   5. Install plugin via marketplace: freecode plugin install freecode-gmail-connector
 *   6. First tool call triggers OAuth flow in default browser
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFile, writeFile, existsSync } from "fs";
import { promisify } from "util";

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// --- OAuth Token Management ---

async function getToken() {
  const tokenFile = process.env.GMAIL_TOKEN_FILE || "~/.freecode/.gmail-token.json";
  const resolvedPath = tokenFile.startsWith("~") ? process.env.HOME + tokenFile.slice(1) : tokenFile;

  try {
    const data = await readFileAsync(resolvedPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveToken(token) {
  const tokenFile = process.env.GMAIL_TOKEN_FILE || "~/.freecode/.gmail-token.json";
  const resolvedPath = tokenFile.startsWith("~") ? process.env.HOME + tokenFile.slice(1) : tokenFile;
  await writeFileAsync(resolvedPath, JSON.stringify(token, null, 2));
}

// --- Gmail API Client ---

class GmailClient {
  constructor() {
    this.baseUrl = "https://gmail.googleapis.com/gmail/v1";
    this.clientId = process.env.GMAIL_CLIENT_ID;
    this.clientSecret = process.env.GMAIL_CLIENT_SECRET;
    this.redirectUri = process.env.GMAIL_REDIRECT_URI || "http://localhost:41122";
    this.token = null;
  }

  async authenticate() {
    this.token = await getToken();
    if (!this.token || this.token.expiry_time < Date.now() / 1000) {
      if (this.token && this.token.refresh_token) {
        await this.refreshAccessToken();
      } else {
        // First run: output OAuth URL for user to authorize
        const authUrl = this.getAuthUrl();
        console.error(`\n[Gmail OAuth] Open this URL in your browser:`);
        console.error(`${authUrl}\n`);
        console.error(`After authorizing, the token will be stored automatically.`);
        // In a full implementation, start a local HTTP server to catch the callback
        // For MCP servers, we output the URL and the user completes the flow
        return false;
      }
    }
    return true;
  }

  getAuthUrl() {
    const scope = encodeURIComponent(
      "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"
    );
    return (
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${this.clientId}` +
      `&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
      `&scope=${scope}` +
      `&response_type=code` +
      `&access_type=offline` +
      `&prompt=consent`
    );
  }

  async refreshAccessToken() {
    const response = await fetch("https://oauth2.googleapis.com/token", {
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
    newToken.expiry_time = Date.now() / 1000 + newToken.expires_in;
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
      throw new Error(`Gmail API ${res.status}: ${err}`);
    }
    return res.json();
  }

  // --- Inbox operations ---

  async listMessages(params = {}) {
    const qs = new URLSearchParams({
      maxResults: params.maxResults || "20",
      q: params.query || "",
      includeSpamTrash: params.includeSpamTrash || "false",
    });
    const data = await this.request("GET", `/users/me/messages?${qs}`);
    return data.messages || [];
  }

  async getMessage(id) {
    const fmt = params => {
      const p = {};
      if (params.format === "full") p.format = "full";
      return p;
    };
    return this.request("GET", `/users/me/messages/${id}`);
  }

  async sendMessage(userId, raw) {
    return this.request("POST", `/users/${userId}/messages/send`, { raw });
  }

  async createDraft(userId, message) {
    return this.request("POST", `/users/${userId}/drafts`, { message });
  }

  async modifyMessage(id, body) {
    return this.request("PUT", `/users/me/messages/${id}/modify`, body);
  }

  async deleteMessage(id) {
    return this.request("DELETE", `/users/me/messages/${id}`);
  }

  async listLabels() {
    return this.request("GET", `/users/me/labels`);
  }

  async labelMessage(id, addLabels = [], removeLabels = []) {
    const body = {};
    if (addLabels.length) body.addLabelIds = addLabels;
    if (removeLabels.length) body.removeLabelIds = removeLabels;
    return this.request("PUT", `/users/me/messages/${id}/modify`, body);
  }

  async getThread(threadId) {
    return this.request("GET", `/users/me/threads/${threadId}`);
  }
}

// --- Encode/Decode Helpers ---

function encodeMimeMessage(from, to, subject, body, html = false, replyTo = null, cc = null) {
  const boundaries = ["----=_Part_0", "----=_Part_1", "----=_Part_2", "----=_Boundary_"];
  let mime = "";

  mime += `From: ${from}\r\n`;
  mime += `To: ${Array.isArray(to) ? to.join(", ") : to}\r\n`;
  if (cc) mime += `Cc: ${cc}\r\n`;
  if (replyTo) mime += `Reply-To: ${replyTo}\r\n`;
  mime += `Subject: ${subject}\r\n`;
  mime += "MIME-Version: 1.0\r\n";

  if (html) {
    mime += `Content-Type: multipart/alternative; boundary="${boundaries[0]}"\r\n`;
    mime += `\r\n--${boundaries[0]}\r\n`;
    mime += `Content-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n`;
    mime += body.replace(/<[^>]*>/g, "") + "\r\n";
    mime += `\r\n--${boundaries[0]}\r\n`;
    mime += `Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n`;
    mime += body + "\r\n";
    mime += `\r\n--${boundaries[0]}--\r\n`;
  } else {
    mime += 'Content-Type: text/plain; charset="UTF-8"\r\n';
    mime += "Content-Transfer-Encoding: 7bit\r\n";
    mime += `\r\n${body}\r\n`;
  }

  const encoded = Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return encoded;
}

function decodeMimeMessage(raw) {
  const decoded = Buffer.from(
    raw.replace(/-/g, "+").replace(/_/g, "/").replace(/=/g, ""),
    "base64"
  ).toString("utf-8");

  const headers = {};
  const headerEnd = decoded.indexOf("\r\n\r\n");
  if (headerEnd > -1) {
    decoded.slice(0, headerEnd).split("\r\n").forEach(line => {
      const colonIdx = line.indexOf(":");
      if (colonIdx > -1) {
        headers[line.slice(0, colonIdx).toLowerCase()] = line.slice(colonIdx + 2);
      }
    });
  }

  return {
    headers,
    subject: headers.subject || "",
    from: headers.from || "",
    to: headers.to || "",
    date: headers.date || "",
    body: decoded.slice(headerEnd + 4),
  };
}

// --- MCP Server Setup ---

const gmail = new GmailClient();
const server = new McpServer({
  name: "gmail-api-connector",
  version: "1.0.0",
});

server.tool(
  "gmail_read_inbox",
  "List recent messages in your inbox. Supports filtering by sender, recipient, subject, and labels.",
  {
    maxResults: { type: "string", description: "Max messages to return (default: 20)", default: "20" },
    query: { type: "string", description: 'Search query (e.g., "from:alice@example.com is:unread")' },
  },
  async ({ maxResults, query }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return {
        content: [{ type: "text", text: "OAuth authentication required. Please complete the OAuth flow." }],
        isError: true,
      };
    }
    const messages = await gmail.listMessages({ maxResults, query: query || undefined });
    return {
      content: [
        {
          type: "text",
          text: `Found ${messages.length} messages.\n${messages
            .slice(0, 10)
            .map((m, i) => `${i + 1}. ID: ${m.id} | Thread: ${m.threadId} | Snippet: ${m.snippet || "N/A"}`)
            .join("\n")}`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_read_message",
  "Read a full email message by its ID. Returns headers, body, and snippet.",
  {
    messageId: { type: "string", description: "The Gmail message ID to read" },
  },
  async ({ messageId }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    const msg = await gmail.getMessage(messageId, { format: "full" });
    const decoded = decodeMimeMessage(msg.payload.parts?.find(p => p.mimeType === "text/plain")?.body?.data || msg.payload.body.data || "");
    return {
      content: [
        {
          type: "text",
          text: `From: ${decoded.from}\nTo: ${decoded.to}\nDate: ${decoded.date}\nSubject: ${decoded.subject}\n\n${decoded.body}`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_search_messages",
  "Search messages using Gmail query syntax. Supports operators: from:, to:, subject:, has:attachment, older:, newer:, is:unread, etc.",
  {
    query: { type: "string", description: 'Gmail search query (e.g., "from:boss@company.com has:attachment newer:2024/01/01")' },
    maxResults: { type: "string", description: "Max results (default: 20)", default: "20" },
  },
  async ({ query, maxResults }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    const messages = await gmail.listMessages({ maxResults, query });
    const results = await Promise.all(
      messages.slice(0, 10).map(async m => {
        const full = await gmail.getMessage(m.id);
        return { id: m.id, snippet: m.snippet, labels: full.labelIds };
      })
    );
    return {
      content: [
        {
          type: "text",
          text: `Search results for "${query}":\n${JSON.stringify(results, null, 2)}`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_send_message",
  "Send an email immediately via the Gmail API. Plain text or HTML.",
  {
    to: { type: "string", description: "Recipient email address(es), comma-separated for multiple" },
    subject: { type: "string", description: "Email subject line" },
    body: { type: "string", description: "Email body content" },
    html: { type: "boolean", description: "Set to true for HTML body", default: false },
    cc: { type: "string", description: "CC recipients (optional)" },
    replyTo: { type: "string", description: "Reply-To address (optional)" },
  },
  async ({ to, subject, body, html, cc, replyTo }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    const fromAddress = process.env.GMAIL_FROM_ADDRESS || "";
    const raw = encodeMimeMessage(fromAddress || "me", to, subject, body, html || false, replyTo || null, cc || null);
    const sent = await gmail.sendMessage("me", raw);
    return {
      content: [
        {
          type: "text",
          text: `Email sent successfully.\nMessage ID: ${sent.id}\nThread ID: ${sent.threadId}`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_compose_draft",
  "Create a draft email without sending it. Useful for review before sending.",
  {
    to: { type: "string", description: "Recipient email address(es)" },
    subject: { type: "string", description: "Draft subject line" },
    body: { type: "string", description: "Draft body content" },
    html: { type: "boolean", description: "Set to true for HTML body", default: false },
  },
  async ({ to, subject, body, html }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    const raw = encodeMimeMessage("", to, subject, body, html || false);
    const message = { raw };
    const draft = await gmail.createDraft("me", message);
    return {
      content: [
        {
          type: "text",
          text: `Draft created successfully.\nDraft ID: ${draft.id}\nMessage ID: ${draft.message?.id}`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_reply_to_thread",
  "Reply to an existing email thread by thread ID.",
  {
    threadId: { type: "string", description: "The Gmail thread ID to reply to" },
    body: { type: "string", description: "Reply body text" },
  },
  async ({ threadId, body }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    const thread = await gmail.getThread(threadId);
    const lastMsg = thread.messages[thread.messages.length - 1];
    const decoded = decodeMimeMessage(lastMsg.payload.body.data || "");
    const raw = encodeMimeMessage("", decoded.from, `Re: ${decoded.subject}`, body);
    const sent = await gmail.sendMessage("me", raw);
    return {
      content: [
        {
          type: "text",
          text: `Reply sent to thread ${threadId}.\nMessage ID: ${sent.id}`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_get_labels",
  "List all labels in your Gmail account.",
  {},
  async () => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    const labels = await gmail.listLabels();
    return {
      content: [
        {
          type: "text",
          text: `Labels (${labels.labels?.length || 0}):\n${(labels.labels || [])
            .map(l => `  ${l.id} - ${l.name} (messages: ${l.messageCount})`)
            .join("\n")}`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_add_labels",
  "Add or remove labels from a message.",
  {
    messageId: { type: "string", description: "The message ID to label" },
    addLabels: { type: "string", description: "Comma-separated label names to add" },
    removeLabels: { type: "string", description: "Comma-separated label names to remove" },
  },
  async ({ messageId, addLabels, removeLabels }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    await gmail.labelMessage(
      messageId,
      addLabels ? addLabels.split(",").map(s => s.trim()) : [],
      removeLabels ? removeLabels.split(",").map(s => s.trim()) : []
    );
    return {
      content: [
        {
          type: "text",
          text: `Labels updated for message ${messageId}.`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_delete_message",
  "Permanently delete a message (move to Trash).",
  {
    messageId: { type: "string", description: "The message ID to delete" },
  },
  async ({ messageId }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    await gmail.deleteMessage(messageId);
    return {
      content: [
        { type: "text", text: `Message ${messageId} moved to Trash.` },
      ],
    };
  }
);

server.tool(
  "gmail_mark_as_read",
  "Mark messages as read or unread.",
  {
    messageId: { type: "string", description: "The message ID to mark" },
    markRead: { type: "boolean", description: "true to mark as read, false to mark as unread", default: true },
  },
  async ({ messageId, markRead }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    const body = markRead
      ? { removeLabelIds: ["UNREAD"] }
      : { addLabelIds: ["UNREAD"] };
    await gmail.modifyMessage(messageId, body);
    return {
      content: [
        {
          type: "text",
          text: `Message ${messageId} marked as ${markRead ? "read" : "unread"}.`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_thread_history",
  "Get the full conversation thread for a given thread ID.",
  {
    threadId: { type: "string", description: "The Gmail thread ID" },
  },
  async ({ threadId }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    const thread = await gmail.getThread(threadId);
    const messages = thread.messages || [];
    const summary = messages
      .map((m, i) => {
        const decoded = decodeMimeMessage(m.payload.body.data || "");
        return `${i + 1}. [${decoded.date}] ${decoded.from}: ${decoded.subject}`;
      })
      .join("\n");
    return {
      content: [
        {
          type: "text",
          text: `Thread ${threadId} (${messages.length} messages):\n${summary}`,
        },
      ],
    };
  }
);

server.tool(
  "gmail_send_html",
  "Send an HTML-formatted email. Supports inline styles, tables, and embedded content.",
  {
    to: { type: "string", description: "Recipient email address(es)" },
    subject: { type: "string", description: "Email subject" },
    htmlBody: { type: "string", description: "HTML content for the email body" },
    cc: { type: "string", description: "CC recipients (optional)" },
  },
  async ({ to, subject, htmlBody, cc }) => {
    const authenticated = await gmail.authenticate();
    if (!authenticated) {
      return { content: [{ type: "text", text: "OAuth authentication required." }], isError: true };
    }
    const raw = encodeMimeMessage("", to, subject, htmlBody, true, null, cc || null);
    const sent = await gmail.sendMessage("me", raw);
    return {
      content: [
        {
          type: "text",
          text: `HTML email sent successfully.\nMessage ID: ${sent.id}`,
        },
      ],
    };
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Gmail MCP server running on stdio");
