#!/usr/bin/env node
/**
 * Gmail MCP Server - API-based Gmail integration (zero-dependency)
 *
 * Provides tools for reading, searching, composing, sending, and labeling emails
 * via the Gmail REST API. Uses OAuth 2.0 with token persistence.
 *
 * Uses raw JSON-RPC over stdio — no external npm dependencies required.
 *
 * Tools exposed:
 *   - auth_gmail                 Get OAuth authorization URL
 *   - auth_gmail_exchange_code   Exchange authorization code for tokens
 *   - gmail_read_inbox           List recent messages with filters
 *   - gmail_read_message         Read a full message by ID
 *   - gmail_search_messages      Search messages by query
 *   - gmail_compose_draft        Create a draft email
 *   - gmail_send_message         Send an email immediately
 *   - gmail_reply_to_thread      Reply to an existing thread
 *   - gmail_add_labels           Add or remove labels from a message
 *   - gmail_get_labels           List all labels
 *   - gmail_delete_message       Move a message to trash
 *   - gmail_mark_as_read         Mark messages as read/unread
 *   - gmail_thread_history       Get full thread conversation
 *   - gmail_send_html            Send HTML-formatted email
 *
 * Setup:
 *   1. Create project at https://console.cloud.google.com
 *   2. Enable Gmail API
 *   3. Create OAuth 2.0 credentials (Desktop app type)
 *   4. Download client_secret.json or copy Client ID + Secret
 *   5. Install plugin via marketplace: freecode plugin install freecode-gmail-connector
 *   6. Call auth_gmail tool to begin OAuth flow
 */

const { readFile, writeFile } = require("fs");
const { promisify } = require("util");
const http = require("http");
const { URL } = require("url");

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

// --- Token helpers ---

function getTokenPath() {
  const p = process.env.GMAIL_TOKEN_FILE || "~/.freecode/.gmail-token.json";
  return p.startsWith("~") ? (process.env.HOME || process.env.USERPROFILE || "") + p.slice(1) : p;
}

async function getToken() {
  try { return JSON.parse(await readFileAsync(getTokenPath(), "utf-8")); }
  catch { return null; }
}

async function saveToken(token) {
  await writeFileAsync(getTokenPath(), JSON.stringify(token, null, 2));
}

// --- Gmail API Client ---

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CLIENT_ID = process.env.GMAIL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || "";
const REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || "http://localhost:41122";

async function ensureAuthenticated() {
  const token = await getToken();
  if (!token || token.expiry_time < Date.now() / 1000) {
    if (token && token.refresh_token) {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: token.refresh_token,
        }),
      });
      const newToken = await res.json();
      newToken.expiry_time = Date.now() / 1000 + newToken.expires_in;
      newToken.refresh_token = token.refresh_token;
      await saveToken(newToken);
      return true;
    }
    return false;
  }
  return true;
}

function getAuthUrl() {
  const scope = encodeURIComponent(
    "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"
  );
  return (
    `https://accounts.google.com/o/oauth2/v2/auth` +
    `?client_id=${CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${scope}` +
    `&response_type=code` +
    `&access_type=offline` +
    `&prompt=consent`
  );
}

async function exchangeCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: code.trim(),
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (data.access_token) {
    data.expiry_time = Date.now() / 1000 + (data.expires_in || 3600);
    await saveToken(data);
    return data;
  }
  throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
}

// --- OAuth redirect callback server ---
//
// Google redirects the browser to REDIRECT_URI (default
// http://localhost:41122) with a `code` (or `error`) query param after the
// user grants/denies access. Nothing listens on that port by default, so the
// browser shows "site can't be reached" and the code is never captured. This
// starts a short-lived local HTTP server that catches that redirect,
// exchanges the code for tokens, persists them, and shows the user a page
// confirming they can return to the app.

let callbackServer = null;

function startCallbackServer() {
  if (callbackServer) return;

  let redirect;
  try {
    redirect = new URL(REDIRECT_URI);
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
      reqUrl = new URL(req.url, REDIRECT_URI);
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
      res.end(page("Gmail authorization failed", `Google returned an error: <code>${error}</code>.`));
    } else if (code) {
      try {
        await exchangeCode(code);
        res.writeHead(200);
        res.end(page("Gmail connected", "Authentication succeeded and your token was saved."));
      } catch (e) {
        res.writeHead(500);
        res.end(page("Gmail authorization failed", `Token exchange failed: ${e.message}`));
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

async function gmailRequest(method, path, body) {
  const token = await getToken();
  const url = `${GMAIL_API}${path}`;
  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${token.access_token}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail API ${res.status}: ${err}`);
  }
  return res.json();
}

// --- Encode/Decode Helpers ---

function encodeMimeMessage(from, to, subject, body, html, replyTo, cc) {
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

  return Buffer.from(mime).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
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

// --- Tool Implementations ---

const unauthMsg = { content: [{ type: "text", text: "Not authenticated with Gmail. Call auth_gmail to get the authorization URL, complete the browser flow, then call auth_gmail_exchange_code with the code." }] };

const tools = {
  auth_gmail: {
    description: "Get the OAuth authorization URL for Gmail. Open this URL in your browser and authorize the app. The redirect will be captured automatically and your token saved; if that fails, copy the authorization code from the redirect URL and pass it to auth_gmail_exchange_code.",
    parameters: {},
    handler: async () => {
      startCallbackServer();
      return { content: [{ type: "text", text: `Open this URL in your browser to authorize Gmail access:\n\n${getAuthUrl()}\n\nAfter authorizing, the browser will be redirected back and your token will be saved automatically. If the page shows an error instead of a confirmation, copy the 'code' parameter from the redirect URL and pass it to the auth_gmail_exchange_code tool.` }] };
    },
  },

  auth_gmail_exchange_code: {
    description: "Exchange an OAuth authorization code for Gmail access tokens. Call this after completing the browser auth flow.",
    parameters: { code: { type: "string", description: "The authorization code from the redirect URL" } },
    handler: async ({ code }) => {
      try {
        await exchangeCode(code);
        return { content: [{ type: "text", text: "Gmail authentication successful! Token saved. You can now use Gmail tools." }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Auth failed: ${e.message}` }], isError: true };
      }
    },
  },

  gmail_read_inbox: {
    description: "List recent messages in your inbox. Supports filtering by sender, recipient, subject, and labels.",
    parameters: {
      maxResults: { type: "string", description: "Max messages to return (default: 20)", default: "20" },
      query: { type: "string", description: 'Search query (e.g., "from:alice@example.com is:unread")' },
    },
    handler: async ({ maxResults, query }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const qs = new URLSearchParams({ maxResults: maxResults || "20", q: query || "", includeSpamTrash: "false" });
      const data = await gmailRequest("GET", `/users/me/messages?${qs}`);
      const messages = data.messages || [];
      return {
        content: [{ type: "text", text: `Found ${messages.length} messages.\n${messages.slice(0, 10).map((m, i) => `${i + 1}. ID: ${m.id} | Thread: ${m.threadId} | Snippet: ${m.snippet || "N/A"}`).join("\n")}` }],
      };
    },
  },

  gmail_read_message: {
    description: "Read a full email message by its ID. Returns headers, body, and snippet.",
    parameters: { messageId: { type: "string", description: "The Gmail message ID to read" } },
    handler: async ({ messageId }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const msg = await gmailRequest("GET", `/users/me/messages/${messageId}`);
      const rawData = msg.payload?.parts?.find(p => p.mimeType === "text/plain")?.body?.data || msg.payload?.body?.data || "";
      const decoded = decodeMimeMessage(rawData);
      return { content: [{ type: "text", text: `From: ${decoded.from}\nTo: ${decoded.to}\nDate: ${decoded.date}\nSubject: ${decoded.subject}\n\n${decoded.body}` }] };
    },
  },

  gmail_search_messages: {
    description: "Search messages using Gmail query syntax. Supports operators: from:, to:, subject:, has:attachment, older:, newer:, is:unread, etc.",
    parameters: {
      query: { type: "string", description: 'Gmail search query (e.g., "from:boss@company.com has:attachment newer:2024/01/01")' },
      maxResults: { type: "string", description: "Max results (default: 20)", default: "20" },
    },
    handler: async ({ query, maxResults }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const qs = new URLSearchParams({ maxResults: maxResults || "20", q: query || "", includeSpamTrash: "false" });
      const data = await gmailRequest("GET", `/users/me/messages?${qs}`);
      const messages = data.messages || [];
      const results = await Promise.all(
        messages.slice(0, 10).map(async m => {
          const full = await gmailRequest("GET", `/users/me/messages/${m.id}`);
          return { id: m.id, snippet: m.snippet, labels: full.labelIds };
        })
      );
      return { content: [{ type: "text", text: `Search results for "${query}":\n${JSON.stringify(results, null, 2)}` }] };
    },
  },

  gmail_send_message: {
    description: "Send an email immediately via the Gmail API. Plain text or HTML.",
    parameters: {
      to: { type: "string", description: "Recipient email address(es), comma-separated for multiple" },
      subject: { type: "string", description: "Email subject line" },
      body: { type: "string", description: "Email body content" },
      html: { type: "boolean", description: "Set to true for HTML body", default: false },
      cc: { type: "string", description: "CC recipients (optional)" },
      replyTo: { type: "string", description: "Reply-To address (optional)" },
    },
    handler: async ({ to, subject, body, html, cc, replyTo }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const fromAddress = process.env.GMAIL_FROM_ADDRESS || "";
      const raw = encodeMimeMessage(fromAddress || "me", to, subject, body, html || false, replyTo || null, cc || null);
      const sent = await gmailRequest("POST", `/users/me/messages/send`, { raw });
      return { content: [{ type: "text", text: `Email sent successfully.\nMessage ID: ${sent.id}\nThread ID: ${sent.threadId}` }] };
    },
  },

  gmail_compose_draft: {
    description: "Create a draft email without sending it. Useful for review before sending.",
    parameters: {
      to: { type: "string", description: "Recipient email address(es)" },
      subject: { type: "string", description: "Draft subject line" },
      body: { type: "string", description: "Draft body content" },
      html: { type: "boolean", description: "Set to true for HTML body", default: false },
    },
    handler: async ({ to, subject, body, html }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const raw = encodeMimeMessage("", to, subject, body, html || false);
      const draft = await gmailRequest("POST", `/users/me/drafts`, { raw });
      return { content: [{ type: "text", text: `Draft created successfully.\nDraft ID: ${draft.id}\nMessage ID: ${draft.message?.id}` }] };
    },
  },

  gmail_reply_to_thread: {
    description: "Reply to an existing email thread by thread ID.",
    parameters: {
      threadId: { type: "string", description: "The Gmail thread ID to reply to" },
      body: { type: "string", description: "Reply body text" },
    },
    handler: async ({ threadId, body }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const thread = await gmailRequest("GET", `/users/me/threads/${threadId}`);
      const lastMsg = thread.messages[thread.messages.length - 1];
      const decoded = decodeMimeMessage(lastMsg.payload?.body?.data || "");
      const raw = encodeMimeMessage("", decoded.from, `Re: ${decoded.subject}`, body);
      const sent = await gmailRequest("POST", `/users/me/messages/send`, { raw });
      return { content: [{ type: "text", text: `Reply sent to thread ${threadId}.\nMessage ID: ${sent.id}` }] };
    },
  },

  gmail_get_labels: {
    description: "List all labels in your Gmail account.",
    parameters: {},
    handler: async () => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const labels = await gmailRequest("GET", `/users/me/labels`);
      return { content: [{ type: "text", text: `Labels (${labels.labels?.length || 0}):\n${(labels.labels || []).map(l => `  ${l.id} - ${l.name} (messages: ${l.messageCount})`).join("\n")}` }] };
    },
  },

  gmail_add_labels: {
    description: "Add or remove labels from a message.",
    parameters: {
      messageId: { type: "string", description: "The message ID to label" },
      addLabels: { type: "string", description: "Comma-separated label names to add" },
      removeLabels: { type: "string", description: "Comma-separated label names to remove" },
    },
    handler: async ({ messageId, addLabels, removeLabels }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const body = {};
      if (addLabels) body.addLabelIds = addLabels.split(",").map(s => s.trim());
      if (removeLabels) body.removeLabelIds = removeLabels.split(",").map(s => s.trim());
      await gmailRequest("PUT", `/users/me/messages/${messageId}/modify`, body);
      return { content: [{ type: "text", text: `Labels updated for message ${messageId}.` }] };
    },
  },

  gmail_delete_message: {
    description: "Permanently delete a message (move to Trash).",
    parameters: { messageId: { type: "string", description: "The message ID to delete" } },
    handler: async ({ messageId }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      await gmailRequest("DELETE", `/users/me/messages/${messageId}`);
      return { content: [{ type: "text", text: `Message ${messageId} moved to Trash.` }] };
    },
  },

  gmail_mark_as_read: {
    description: "Mark messages as read or unread.",
    parameters: {
      messageId: { type: "string", description: "The message ID to mark" },
      markRead: { type: "boolean", description: "true to mark as read, false to mark as unread", default: true },
    },
    handler: async ({ messageId, markRead }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const body = markRead ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] };
      await gmailRequest("PUT", `/users/me/messages/${messageId}/modify`, body);
      return { content: [{ type: "text", text: `Message ${messageId} marked as ${markRead ? "read" : "unread"}.` }] };
    },
  },

  gmail_thread_history: {
    description: "Get the full conversation thread for a given thread ID.",
    parameters: { threadId: { type: "string", description: "The Gmail thread ID" } },
    handler: async ({ threadId }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const thread = await gmailRequest("GET", `/users/me/threads/${threadId}`);
      const messages = thread.messages || [];
      const summary = messages.map((m, i) => {
        const decoded = decodeMimeMessage(m.payload?.body?.data || "");
        return `${i + 1}. [${decoded.date}] ${decoded.from}: ${decoded.subject}`;
      }).join("\n");
      return { content: [{ type: "text", text: `Thread ${threadId} (${messages.length} messages):\n${summary}` }] };
    },
  },

  gmail_send_html: {
    description: "Send an HTML-formatted email. Supports inline styles, tables, and embedded content.",
    parameters: {
      to: { type: "string", description: "Recipient email address(es)" },
      subject: { type: "string", description: "Email subject" },
      htmlBody: { type: "string", description: "HTML content for the email body" },
      cc: { type: "string", description: "CC recipients (optional)" },
    },
    handler: async ({ to, subject, htmlBody, cc }) => {
      if (!(await ensureAuthenticated())) return unauthMsg;
      const raw = encodeMimeMessage("", to, subject, htmlBody, true, null, cc || null);
      const sent = await gmailRequest("POST", `/users/me/messages/send`, { raw });
      return { content: [{ type: "text", text: `HTML email sent successfully.\nMessage ID: ${sent.id}` }] };
    },
  },
};

// --- JSON-RPC Server (raw stdio) ---

const readline = require("readline");
const rl = readline.createInterface({ input: process.stdin });

rl.on("line", async (raw) => {
  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }) + "\n");
    return;
  }

  const { id, method, params } = request;

  if (method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gmail-api-connector", version: "1.0.0" },
      },
      id,
    }) + "\n");
    return;
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    const toolList = Object.values(tools).map(t => ({
      name: Object.keys(tools).find(k => tools[k] === t),
      description: t.description,
      inputSchema: { type: "object", properties: t.parameters, required: [] },
    }));
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", result: { tools: toolList }, id }) + "\n");
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const arguments_ = params?.arguments || {};
    const tool = tools[toolName];
    if (!tool) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", error: { code: -32601, message: `Unknown tool: ${toolName}` }, id }) + "\n");
      return;
    }
    try {
      const result = await tool.handler(arguments_);
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", result: { content: result.content, isError: result.isError }, id }) + "\n");
    } catch (e) {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", result: { content: [{ type: "text", text: e.message }], isError: true }, id }) + "\n");
    }
    return;
  }

  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", error: { code: -32601, message: `Unknown method: ${method}` }, id }) + "\n");
});

console.error("Gmail MCP server running on stdio");
